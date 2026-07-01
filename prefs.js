import Gio from 'gi://Gio';
import Gdk from 'gi://Gdk';
import Adw from 'gi://Adw';
import Gtk from 'gi://Gtk';
import { ExtensionPreferences } from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

// Campi di un override, condivisi tra gli slider globali (fallback) e quelli
// per-monitor: stessa chiave usata in extension.js dentro monitor-overrides.
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

        const page = new Adw.PreferencesPage({
            title: 'Color Correction',
            icon_name: 'preferences-color-symbolic',
        });
        window.add(page);

        const brightnessGroup = new Adw.PreferencesGroup({
            title: 'Brightness per channel',
            description: '1.0 = no change, lower = darker (default / fallback for monitors without an override)',
        });
        page.add(brightnessGroup);

        for (const [key, label] of [
            ['red-factor',   'Red brightness'],
            ['green-factor', 'Green brightness'],
            ['blue-factor',  'Blue brightness'],
        ]) {
            brightnessGroup.add(this._makeSliderRow(settings, key, label, 0.1, 1.0));
        }

        const satGroup = new Adw.PreferencesGroup({
            title: 'Saturation per channel',
            description: '1.0 = no change, lower = less saturated (default / fallback for monitors without an override)',
        });
        page.add(satGroup);

        for (const [key, label] of [
            ['red-saturation',   'Red saturation'],
            ['green-saturation', 'Green saturation'],
            ['blue-saturation',  'Blue saturation'],
        ]) {
            satGroup.add(this._makeSliderRow(settings, key, label, 0.0, 2.0));
        }

        const monitorsGroup = new Adw.PreferencesGroup({
            title: 'Per-monitor overrides',
            description: 'Enable to set custom values for a specific monitor, overriding the defaults above.',
        });
        page.add(monitorsGroup);

        const monitors = this._listMonitors();
        if (monitors.length === 0) {
            monitorsGroup.add(new Adw.ActionRow({
                title: 'No monitors detected',
                subtitle: 'Reopen preferences after connecting a monitor.',
            }));
        } else {
            for (const { connector, label } of monitors)
                monitorsGroup.add(this._makeMonitorRow(settings, connector, label));
        }
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

    _setOverrideEnabled(settings, connector, enabled, adjustments) {
        const overrides = this._loadOverrides(settings);
        if (enabled) {
            const o = {};
            for (const [field] of CHANNEL_FIELDS)
                o[field] = adjustments[field].get_value();
            overrides[connector] = o;
        } else {
            delete overrides[connector];
        }
        this._saveOverrides(settings, overrides);
    }

    _makeMonitorRow(settings, connector, label) {
        const overrides = this._loadOverrides(settings);
        const existing = overrides[connector];

        const expander = new Adw.ExpanderRow({
            title: label,
            subtitle: connector,
            show_enable_switch: true,
            enable_expansion: !!existing,
            expanded: !!existing,
        });

        const adjustments = {};
        for (const [field, sliderLabel, min, max, fallbackKey] of CHANNEL_FIELDS) {
            const value = existing?.[field] ?? settings.get_double(fallbackKey);
            const adjustment = new Gtk.Adjustment({
                lower: min, upper: max,
                step_increment: 0.01, page_increment: 0.05,
                value,
            });
            adjustments[field] = adjustment;
            adjustment.connect('value-changed', () => {
                if (expander.enable_expansion)
                    this._updateOverrideField(settings, connector, field, adjustment.get_value());
            });

            const scale = new Gtk.Scale({
                orientation: Gtk.Orientation.HORIZONTAL,
                adjustment, digits: 2, draw_value: true,
                value_pos: Gtk.PositionType.RIGHT,
                hexpand: true, width_request: 300,
            });

            const row = new Adw.ActionRow({ title: sliderLabel });
            row.add_suffix(scale);
            row.set_activatable_widget(scale);
            expander.add_row(row);
        }

        expander.connect('notify::enable-expansion', () => {
            this._setOverrideEnabled(settings, connector, expander.enable_expansion, adjustments);
        });

        return expander;
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
