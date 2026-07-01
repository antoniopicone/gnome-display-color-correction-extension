import Clutter from 'gi://Clutter';
import Shell from 'gi://Shell';
import Cogl from 'gi://Cogl';
import GObject from 'gi://GObject';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';

const SHADER_DECL = `
uniform float r_factor;
uniform float g_factor;
uniform float b_factor;
uniform float r_sat;
uniform float g_sat;
uniform float b_sat;
`;

const SHADER_CODE = `
vec3 color = cogl_color_out.rgb;

// Brightness correction per channel
color.r = color.r * r_factor;
color.g = color.g * g_factor;
color.b = color.b * b_factor;

// Selective saturation per channel
float lum = dot(color, vec3(0.2126, 0.7152, 0.0722));

float r_delta = color.r - lum;
color.r = lum + r_delta * r_sat;

float g_delta = color.g - lum;
color.g = lum + g_delta * g_sat;

float b_delta = color.b - lum;
color.b = lum + b_delta * b_sat;

color = clamp(color, 0.0, 1.0);
cogl_color_out.rgb = color;
`;

const ColorCorrectionEffect = GObject.registerClass(
class ColorCorrectionEffect extends Shell.GLSLEffect {
    constructor() {
        super();
        this._rLoc    = this.get_uniform_location('r_factor');
        this._gLoc    = this.get_uniform_location('g_factor');
        this._bLoc    = this.get_uniform_location('b_factor');
        this._rSatLoc = this.get_uniform_location('r_sat');
        this._gSatLoc = this.get_uniform_location('g_sat');
        this._bSatLoc = this.get_uniform_location('b_sat');
    }

    setFactors(r, g, b, rSat, gSat, bSat) {
        this.set_uniform_float(this._rLoc,    1, [r]);
        this.set_uniform_float(this._gLoc,    1, [g]);
        this.set_uniform_float(this._bLoc,    1, [b]);
        this.set_uniform_float(this._rSatLoc, 1, [rSat]);
        this.set_uniform_float(this._gSatLoc, 1, [gSat]);
        this.set_uniform_float(this._bSatLoc, 1, [bSat]);
        this.queue_repaint();
    }

    vfunc_build_pipeline() {
        const hook = Cogl.SnippetHook
            ? Cogl.SnippetHook.FRAGMENT
            : Shell.SnippetHook.FRAGMENT;
        this.add_glsl_snippet(hook, SHADER_DECL, SHADER_CODE, false);
    }
});

export default class DisplayColorCorrection extends Extension {
    _settings = null;
    _settingsChangedId = 0;
    _monitorsChangedId = 0;
    // Array of { clone, effect, connector }, one per physical monitor.
    _monitorTargets = [];

    enable() {
        try {
            this._settings = this.getSettings(
                'org.gnome.shell.extensions.display-color-correct'
            );
            this._settingsChangedId = this._settings.connect(
                'changed', () => this._applyAllSettings()
            );
            this._monitorsChangedId = Main.layoutManager.connect(
                'monitors-changed', () => this._rebuildMonitorTargets()
            );

            this._rebuildMonitorTargets();

            console.log('[DisplayColorCorrection] Effect applied');
        } catch (e) {
            console.error('[DisplayColorCorrection] Error:', e.message);
        }
    }

    // Distrugge e ricrea un Clutter.Clone + ColorCorrectionEffect per ogni
    // monitor fisico attualmente collegato. Ogni clone condivide la stessa
    // source (uiGroup) e la stessa dimensione/posizione (l'intero stage),
    // ma viene clippato con set_clip() all'area del proprio monitor: solo
    // quella porzione viene ridisegnata attraverso il proprio effect, con
    // i propri valori di brightness/saturation. Le aree non coperte dal
    // clip di un clone lasciano trasparire uiGroup originale sottostante,
    // che è però coperto esattamente dal clone del monitor adiacente.
    //
    // uiGroup stesso non ha mai un effect applicato direttamente (per il
    // motivo già visto: relayout multi-monitor in conflitto con l'offscreen
    // capture durante drag/resize).
    _rebuildMonitorTargets() {
        this._teardownMonitorTargets();

        for (const monitor of Main.layoutManager.monitors) {
            const connector = this._connectorForMonitor(monitor);

            const clone = new Clutter.Clone({
                source: Main.layoutManager.uiGroup,
            });
            Shell.util_set_hidden_from_pick(clone, true);

            const sizeConstraint = new Clutter.BindConstraint({
                source: global.stage,
                coordinate: Clutter.BindCoordinate.SIZE,
            });
            clone.add_constraint(sizeConstraint);
            clone.set_position(0, 0);
            clone.set_clip(monitor.x, monitor.y, monitor.width, monitor.height);

            const effect = new ColorCorrectionEffect();
            clone.add_effect(effect);

            global.stage.add_child(clone);

            console.log(
                `[DisplayColorCorrection] monitor idx=${monitor.index} ` +
                `geom=${monitor.x},${monitor.y} ${monitor.width}x${monitor.height} ` +
                `-> connector="${connector}"`
            );

            this._monitorTargets.push({ clone, effect, connector });
        }

        this._applyAllSettings();
    }

    _teardownMonitorTargets() {
        for (const { clone } of this._monitorTargets) {
            global.stage.remove_child(clone);
            clone.destroy();
        }
        this._monitorTargets = [];
    }

    // Prova a risalire al nome del connettore fisico (es. "eDP-1", "DP-2")
    // incrociando la geometria dei monitor "logici" di layoutManager con i
    // Meta.Monitor esposti dal monitor manager. Se qualcosa non torna (API
    // diversa tra versioni di GNOME Shell, hotplug in corso, ecc.) si
    // ricade su una chiave stabile basata sull'indice del monitor, così
    // l'estensione continua comunque a funzionare (solo senza persistenza
    // dell'override se l'ordine dei monitor cambia tra un riavvio e l'altro).
    _connectorForMonitor(monitor) {
        try {
            // Su questa versione di Mutter, Meta.Monitor e
            // Meta.LogicalMonitor non espongono più alcun metodo di
            // geometria (né get_geometry() né get_layout()): l'unico modo
            // per collegare un Main.layoutManager.monitors[i] al relativo
            // Meta.LogicalMonitor è confrontarne il numero — che coincide
            // con l'indice usato da global.display.get_monitor_geometry(i)
            // (da cui layout.js costruisce monitor.index).
            const monitorManager = global.backend.get_monitor_manager();
            for (const logical of monitorManager.get_logical_monitors()) {
                if (logical.get_number() === monitor.index) {
                    const physicalMonitors = logical.get_monitors();
                    if (physicalMonitors && physicalMonitors.length > 0)
                        return physicalMonitors[0].get_connector();
                }
            }
            console.log(
                `[DisplayColorCorrection] no logical monitor number match for ` +
                `layoutManager monitor idx=${monitor.index}`
            );
        } catch (e) {
            console.error(`[DisplayColorCorrection] connector lookup failed: ${e.message}`);
        }
        return `monitor-${monitor.index}`;
    }

    _loadOverrides() {
        try {
            const raw = this._settings.get_string('monitor-overrides');
            const parsed = raw ? JSON.parse(raw) : {};
            return (parsed && typeof parsed === 'object') ? parsed : {};
        } catch (e) {
            return {};
        }
    }

    _factorsForConnector(connector) {
        const overrides = this._loadOverrides();
        const o = overrides[connector];
        if (o) {
            return [
                o.r    ?? 1.0, o.g    ?? 1.0, o.b    ?? 1.0,
                o.rSat ?? 1.0, o.gSat ?? 1.0, o.bSat ?? 1.0,
            ];
        }
        return [
            this._settings.get_double('red-factor'),
            this._settings.get_double('green-factor'),
            this._settings.get_double('blue-factor'),
            this._settings.get_double('red-saturation'),
            this._settings.get_double('green-saturation'),
            this._settings.get_double('blue-saturation'),
        ];
    }

    _applyAllSettings() {
        const overrides = this._loadOverrides();
        console.log(
            `[DisplayColorCorrection] overrides keys: ${Object.keys(overrides).join(', ') || '(none)'}`
        );
        for (const { effect, connector } of this._monitorTargets) {
            const hasOverride = !!overrides[connector];
            const [r, g, b, rSat, gSat, bSat] = this._factorsForConnector(connector);
            console.log(
                `[DisplayColorCorrection] apply connector="${connector}" ` +
                `override=${hasOverride} r=${r} g=${g} b=${b} rSat=${rSat} gSat=${gSat} bSat=${bSat}`
            );
            effect.setFactors(r, g, b, rSat, gSat, bSat);
        }
    }

    disable() {
        if (this._settingsChangedId) {
            this._settings?.disconnect(this._settingsChangedId);
            this._settingsChangedId = 0;
        }
        if (this._monitorsChangedId) {
            Main.layoutManager.disconnect(this._monitorsChangedId);
            this._monitorsChangedId = 0;
        }
        this._teardownMonitorTargets();
        this._settings = null;
        console.log('[DisplayColorCorrection] Effect removed');
    }
}