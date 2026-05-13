import Gio from 'gi://Gio';
import Adw from 'gi://Adw';
import Gtk from 'gi://Gtk';
import { ExtensionPreferences } from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

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
            description: '1.0 = no change, lower = darker',
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
            description: '1.0 = no change, lower = less saturated',
        });
        page.add(satGroup);

        for (const [key, label] of [
            ['red-saturation',   'Red saturation'],
            ['green-saturation', 'Green saturation'],
            ['blue-saturation',  'Blue saturation'],
        ]) {
            satGroup.add(this._makeSliderRow(settings, key, label, 0.0, 2.0));
        }
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
