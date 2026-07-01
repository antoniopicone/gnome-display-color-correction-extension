import Gio from 'gi://Gio';
import Gdk from 'gi://Gdk';
import Adw from 'gi://Adw';
import Gtk from 'gi://Gtk';
import { ExtensionPreferences } from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

// Campi di un override, condivisi dai controlli globali (default) e da
// quelli per-monitor: stessa chiave usata in extension.js dentro
// monitor-overrides.
const CHANNEL_FIELDS = [
    ['r',    'Red brightness',   0.1, 1.0, 'red-factor'],
    ['g',    'Green brightness', 0.1, 1.0, 'green-factor'],
    ['b',    'Blue brightness',  0.1, 1.0, 'blue-factor'],
    ['rSat', 'Red saturation',   0.0, 2.0, 'red-saturation'],
    ['gSat', 'Green saturation', 0.0, 2.0, 'green-saturation'],
    ['bSat', 'Blue saturation',  0.0, 2.0, 'blue-saturation'],
];

export default class DisplayColorCorrectionPrefs extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const settings = this.getSettings(
            'org.gnome.shell.extensions.display-color-correct'
        );

        window.add(this._buildDefaultsPage(settings));
        window.add(this._buildPerMonitorPage(settings));
    }

    _buildDefaultsPage(settings) {
        const page = new Adw.PreferencesPage({
            title: 'Defaults',
            icon_name: 'preferences-color-symbolic',
        });

        const noticeGroup = new Adw.PreferencesGroup();
        const noticeRow = new Adw.ActionRow({
            title: 'Per-monitor overrides are enabled',
            subtitle: 'These defaults have no effect until you disable ' +
                '"Enable per-monitor overrides" in the Per Monitor tab.',
        });
        noticeRow.add_prefix(new Gtk.Image({ icon_name: 'dialog-warning-symbolic' }));
        noticeGroup.add(noticeRow);
        page.add(noticeGroup);
        settings.bind('per-monitor-enabled', noticeGroup, 'visible',
            Gio.SettingsBindFlags.GET);

        const brightnessGroup = new Adw.PreferencesGroup({
            title: 'Brightness per channel',
            description: '1.0 = no change, lower = darker. Applies to every ' +
                'monitor, unless overridden in the Per Monitor tab.',
        });
        page.add(brightnessGroup);
        settings.bind('per-monitor-enabled', brightnessGroup, 'sensitive',
            Gio.SettingsBindFlags.GET | Gio.SettingsBindFlags.INVERT_BOOLEAN);

        for (const [key, label] of [
            ['red-factor',   'Red brightness'],
            ['green-factor', 'Green brightness'],
            ['blue-factor',  'Blue brightness'],
        ]) {
            brightnessGroup.add(this._makeSliderRow(settings, key, label, 0.1, 1.0));
        }

        const satGroup = new Adw.PreferencesGroup({
            title: 'Saturation per channel',
            description: '1.0 = no change, lower = less saturated. Applies ' +
                'to every monitor, unless overridden in the Per Monitor tab.',
        });
        page.add(satGroup);
        settings.bind('per-monitor-enabled', satGroup, 'sensitive',
            Gio.SettingsBindFlags.GET | Gio.SettingsBindFlags.INVERT_BOOLEAN);

        for (const [key, label] of [
            ['red-saturation',   'Red saturation'],
            ['green-saturation', 'Green saturation'],
            ['blue-saturation',  'Blue saturation'],
        ]) {
            satGroup.add(this._makeSliderRow(settings, key, label, 0.0, 2.0));
        }

        return page;
    }

    _buildPerMonitorPage(settings) {
        const page = new Adw.PreferencesPage({
            title: 'Per Monitor',
            icon_name: 'video-display-symbolic',
        });

        const switchGroup = new Adw.PreferencesGroup();
        page.add(switchGroup);

        const enableRow = new Adw.SwitchRow({
            title: 'Enable per-monitor overrides',
            subtitle: 'When off, every monitor uses the defaults from the Defaults tab.',
        });
        settings.bind('per-monitor-enabled', enableRow, 'active',
            Gio.SettingsBindFlags.DEFAULT);
        switchGroup.add(enableRow);

        const configGroup = new Adw.PreferencesGroup({
            title: 'Monitor settings',
        });
        page.add(configGroup);
        settings.bind('per-monitor-enabled', configGroup, 'visible',
            Gio.SettingsBindFlags.GET);

        const monitors = this._listMonitors();
        if (monitors.length === 0) {
            configGroup.add(new Adw.ActionRow({
                title: 'No monitors detected',
                subtitle: 'Reopen preferences after connecting a monitor.',
            }));
            return page;
        }

        const comboRow = new Adw.ComboRow({
            title: 'Monitor',
            model: Gtk.StringList.new(monitors.map(m => m.label)),
        });
        configGroup.add(comboRow);

        const resetRow = new Adw.ActionRow({
            title: 'Reset this monitor to defaults',
            subtitle: 'Removes its override, falling back to the Defaults tab.',
        });
        const resetButton = new Gtk.Button({
            label: 'Reset',
            valign: Gtk.Align.CENTER,
            css_classes: ['destructive-action'],
        });
        resetRow.add_suffix(resetButton);
        resetRow.set_activatable_widget(resetButton);
        configGroup.add(resetRow);

        const adjustments = {};
        for (const [field, label, min, max] of CHANNEL_FIELDS) {
            const adjustment = new Gtk.Adjustment({
                lower: min, upper: max,
                step_increment: 0.01, page_increment: 0.05,
            });
            const scale = new Gtk.Scale({
                orientation: Gtk.Orientation.HORIZONTAL,
                adjustment, digits: 2, draw_value: true,
                value_pos: Gtk.PositionType.RIGHT,
                hexpand: true, width_request: 300,
            });
            const row = new Adw.ActionRow({ title: label });
            row.add_suffix(scale);
            row.set_activatable_widget(scale);
            configGroup.add(row);
            adjustments[field] = adjustment;
        }

        // Evita che il caricamento programmatico dei valori (al cambio di
        // monitor selezionato) venga interpretato come una modifica
        // dell'utente e riscritto nell'override del monitor sbagliato.
        let suppressSave = false;

        const loadMonitor = index => {
            const { connector } = monitors[index];
            const existing = this._loadOverrides(settings)[connector];
            suppressSave = true;
            for (const [field, , , , fallbackKey] of CHANNEL_FIELDS)
                adjustments[field].set_value(existing?.[field] ?? settings.get_double(fallbackKey));
            suppressSave = false;
        };

        for (const [field] of CHANNEL_FIELDS) {
            adjustments[field].connect('value-changed', () => {
                if (suppressSave)
                    return;
                const { connector } = monitors[comboRow.selected];
                this._updateOverrideField(settings, connector, field, adjustments[field].get_value());
            });
        }

        comboRow.connect('notify::selected', () => loadMonitor(comboRow.selected));

        resetButton.connect('clicked', () => {
            const { connector } = monitors[comboRow.selected];
            const overrides = this._loadOverrides(settings);
            delete overrides[connector];
            this._saveOverrides(settings, overrides);
            loadMonitor(comboRow.selected);
        });

        loadMonitor(0);

        return page;
    }

    _listMonitors() {
        const display = Gdk.Display.get_default();
        if (!display)
            return [];

        const list = display.get_monitors();
        const monitors = [];
        for (let i = 0; i < list.get_n_items(); i++) {
            const monitor = list.get_item(i);
            const connector = monitor.get_connector() ?? `monitor-${i}`;
            const description = [monitor.get_manufacturer(), monitor.get_model()]
                .filter(Boolean).join(' ');
            monitors.push({
                connector,
                label: description ? `${connector} — ${description}` : connector,
            });
        }
        return monitors;
    }

    _loadOverrides(settings) {
        try {
            const raw = settings.get_string('monitor-overrides');
            const parsed = raw ? JSON.parse(raw) : {};
            return (parsed && typeof parsed === 'object') ? parsed : {};
        } catch (e) {
            return {};
        }
    }

    _saveOverrides(settings, overrides) {
        settings.set_string('monitor-overrides', JSON.stringify(overrides));
    }

    _updateOverrideField(settings, connector, field, value) {
        const overrides = this._loadOverrides(settings);
        overrides[connector] = { ...overrides[connector], [field]: value };
        this._saveOverrides(settings, overrides);
    }

    _makeSliderRow(settings, key, label, min, max) {
        const row = new Adw.ActionRow({ title: label });
        const scale = new Gtk.Scale({
            orientation: Gtk.Orientation.HORIZONTAL,
            adjustment: new Gtk.Adjustment({
                lower: min, upper: max,
                step_increment: 0.01, page_increment: 0.05,
                value: settings.get_double(key),
            }),
            digits: 2, draw_value: true,
            value_pos: Gtk.PositionType.RIGHT,
            hexpand: true, width_request: 300,
        });
        settings.bind(key, scale.get_adjustment(), 'value',
            Gio.SettingsBindFlags.DEFAULT);
        row.add_suffix(scale);
        row.set_activatable_widget(scale);
        return row;
    }
}
