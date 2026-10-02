import Clutter from 'gi://Clutter';
import Shell from 'gi://Shell';
import Cogl from 'gi://Cogl';
import GObject from 'gi://GObject';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';

// Numero massimo di monitor gestiti contemporaneamente dallo shader (vedi
// commento in enable() più sotto sul perché la selezione del
// monitor avviene interamente dentro un solo shader invece che con un
// Clutter.Clone per monitor).
const MAX_MONITORS = 6;

const SHADER_DECL = `
uniform float monitor_count;
uniform vec4 monitor_rects[${MAX_MONITORS}];
uniform float r_factor[${MAX_MONITORS}];
uniform float g_factor[${MAX_MONITORS}];
uniform float b_factor[${MAX_MONITORS}];
uniform float r_sat[${MAX_MONITORS}];
uniform float g_sat[${MAX_MONITORS}];
uniform float b_sat[${MAX_MONITORS}];

bool point_in_rect(vec4 rect, vec2 point) {
    return point.x >= rect.x && point.x < rect.x + rect.z &&
           point.y >= rect.y && point.y < rect.y + rect.w;
}
`;

// Sceglie i fattori del monitor a cui appartiene il frammento corrente
// usando solo indici letterali (monitor_rects[0], [1], ...) invece di un
// indice calcolato a runtime: alcuni driver GLES non supportano
// l'indicizzazione dinamica di array uniform nel fragment shader.
let monitorSelectCode = `
int monitor_idx_count = int(monitor_count + 0.5);
float rF = r_factor[0], gF = g_factor[0], bF = b_factor[0];
float rS = r_sat[0],    gS = g_sat[0],    bS = b_sat[0];
`;
for (let i = 1; i < MAX_MONITORS; i++) {
    monitorSelectCode += `
if (monitor_idx_count > ${i} && point_in_rect(monitor_rects[${i}], fragPos)) {
    rF = r_factor[${i}]; gF = g_factor[${i}]; bF = b_factor[${i}];
    rS = r_sat[${i}];    gS = g_sat[${i}];    bS = b_sat[${i}];
}
`;
}

const SHADER_CODE = `
vec3 color = cogl_color_out.rgb;
vec2 fragPos = cogl_tex_coord0_in.st;
${monitorSelectCode}

// Brightness correction per channel
color.r = color.r * rF;
color.g = color.g * gF;
color.b = color.b * bF;

// Selective saturation per channel
float lum = dot(color, vec3(0.2126, 0.7152, 0.0722));

float r_delta = color.r - lum;
color.r = lum + r_delta * rS;

float g_delta = color.g - lum;
color.g = lum + g_delta * gS;

float b_delta = color.b - lum;
color.b = lum + b_delta * bS;

color = clamp(color, 0.0, 1.0);
cogl_color_out.rgb = color;
`;

const UNIFORM_NAMES = [
    'monitor_count', 'monitor_rects',
    'r_factor', 'g_factor', 'b_factor',
    'r_sat', 'g_sat', 'b_sat',
];

// GNOME 48–50: Shell.GLSLEffect, uniform indirizzati per location.
const LegacyColorCorrectionEffect = Shell.GLSLEffect ? GObject.registerClass(
class LegacyColorCorrectionEffect extends Shell.GLSLEffect {
    constructor() {
        super();
        this._locations = {};
        for (const name of UNIFORM_NAMES)
            this._locations[name] = this.get_uniform_location(name);
    }

    _setUniform(name, nComponents, value) {
        this.set_uniform_float(this._locations[name], nComponents, value);
    }

    vfunc_build_pipeline() {
        const hook = Cogl.SnippetHook
            ? Cogl.SnippetHook.FRAGMENT
            : Shell.SnippetHook.FRAGMENT;
        this.add_glsl_snippet(hook, SHADER_DECL, SHADER_CODE, false);
    }
}) : null;

// GNOME 51+: Shell.GLSLEffect è stato rimosso, al suo posto
// Clutter.ShaderEffect con uno snippet statico e uniform indirizzati per nome.
const ShaderColorCorrectionEffect = Shell.GLSLEffect ? null : GObject.registerClass(
class ShaderColorCorrectionEffect extends Clutter.ShaderEffect {
    _setUniform(name, nComponents, value) {
        this.set_uniform_float(name, nComponents, value);
    }

    vfunc_get_static_snippet() {
        const snippet = Cogl.Snippet.new(
            Cogl.SnippetHook.FRAGMENT, SHADER_DECL, ''
        );
        // Post, non replace: il codice generato che campiona la texture in
        // cogl_color_out deve girare prima, come con
        // add_glsl_snippet(..., false) su Shell.GLSLEffect.
        snippet.set_post(SHADER_CODE);
        return snippet;
    }
});

// rects è un array piatto di MAX_MONITORS quadrupli
// (x, y, width, height) normalizzati in [0,1] rispetto allo stage;
// gli altri array hanno MAX_MONITORS elementi, uno per monitor.
function setMonitors(effect, count, rects, r, g, b, rSat, gSat, bSat) {
    effect._setUniform('monitor_count', 1, [count]);
    effect._setUniform('monitor_rects', 4, rects);
    effect._setUniform('r_factor', 1, r);
    effect._setUniform('g_factor', 1, g);
    effect._setUniform('b_factor', 1, b);
    effect._setUniform('r_sat', 1, rSat);
    effect._setUniform('g_sat', 1, gSat);
    effect._setUniform('b_sat', 1, bSat);
    effect.queue_repaint();
}

export default class DisplayColorCorrection extends Extension {
    _settings = null;
    _clone = null;
    _effect = null;

    enable() {
        try {
            this._settings = this.getSettings();

            this._effect = LegacyColorCorrectionEffect
                ? new LegacyColorCorrectionEffect()
                : new ShaderColorCorrectionEffect();

            // Un solo Clutter.Clone di tutto uiGroup con un solo effect,
            // esattamente come nella versione single-monitor originale (vedi
            // Mutter MR!2269): uiGroup è l'actor "vivo" che Mutter rilayouta
            // di continuo durante drag/resize tra monitor diversi, e un
            // ClutterEffect offscreen applicato lì entra in conflitto con
            // quel ciclo causando artefatti. Il clone è invece un nodo
            // passivo che si limita a ridisegnare il contenuto già
            // renderizzato, quindi l'offscreen capture non interferisce.
            //
            // La differenza per-monitor rispetto a un solo colore per tutto
            // lo schermo è realizzata interamente DENTRO lo shader (vedi
            // point_in_rect sopra), non con un Clutter.Clone per monitor:
            // un clone per monitor manteneva comunque ciascuno grande
            // quanto l'intero stage (il clip visivo non riduce la
            // dimensione dell'offscreen usato dall'effect), moltiplicando
            // per N monitor il costo di un render offscreen a schermo
            // intero — da cui il calo di framerate nel drag tra monitor
            // con app Electron. Con un solo clone il costo torna quello di
            // un solo passaggio, indipendentemente dal numero di monitor.
            this._clone = new Clutter.Clone({
                source: Main.layoutManager.uiGroup,
                clip_to_allocation: true,
            });
            Shell.util_set_hidden_from_pick(this._clone, true);
            this._clone.add_constraint(new Clutter.BindConstraint({
                source: global.stage,
                coordinate: Clutter.BindCoordinate.SIZE,
            }));
            this._clone.add_effect(this._effect);
            global.stage.add_child(this._clone);

            this._settings.connectObject(
                'changed', () => this._applyAllSettings(), this);
            Main.layoutManager.connectObject(
                'monitors-changed', () => this._applyAllSettings(), this);

            this._applyAllSettings();

            console.log('[DisplayColorCorrection] Effect applied');
        } catch (e) {
            console.error('[DisplayColorCorrection] Error:', e.message);
        }
    }

    // Prova a risalire al nome del connettore fisico (es. "eDP-1", "DP-2")
    // per un monitor di Main.layoutManager. Su questa versione di Mutter,
    // Meta.Monitor e Meta.LogicalMonitor non espongono più alcun metodo di
    // geometria (né get_geometry() né get_layout()): l'unico modo per
    // collegare un Main.layoutManager.monitors[i] al relativo
    // Meta.LogicalMonitor è confrontarne il numero — che coincide con
    // l'indice usato da global.display.get_monitor_geometry(i) (da cui
    // layout.js costruisce monitor.index). Se qualcosa non torna (API
    // diversa tra versioni di GNOME Shell, hotplug in corso, ecc.) si
    // ricade su una chiave stabile basata sull'indice del monitor, così
    // l'estensione continua comunque a funzionare (solo senza persistenza
    // dell'override se l'ordine dei monitor cambia tra un riavvio e
    // l'altro).
    _connectorForMonitor(monitor) {
        try {
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
        const defaults = [
            this._settings.get_double('red-factor'),
            this._settings.get_double('green-factor'),
            this._settings.get_double('blue-factor'),
            this._settings.get_double('red-saturation'),
            this._settings.get_double('green-saturation'),
            this._settings.get_double('blue-saturation'),
        ];

        if (!this._settings.get_boolean('per-monitor-enabled'))
            return defaults;

        const o = this._loadOverrides()[connector];
        if (!o)
            return defaults;

        return [
            o.r    ?? 1.0, o.g    ?? 1.0, o.b    ?? 1.0,
            o.rSat ?? 1.0, o.gSat ?? 1.0, o.bSat ?? 1.0,
        ];
    }

    _applyAllSettings() {
        const overrides = this._loadOverrides();
        const perMonitorEnabled = this._settings.get_boolean('per-monitor-enabled');
        console.log(
            `[DisplayColorCorrection] per-monitor-enabled=${perMonitorEnabled} ` +
            `overrides keys: ${Object.keys(overrides).join(', ') || '(none)'}`
        );

        const monitors = Main.layoutManager.monitors;
        const stageWidth = global.stage.width;
        const stageHeight = global.stage.height;

        if (monitors.length > MAX_MONITORS) {
            console.warn(
                `[DisplayColorCorrection] ${monitors.length} monitors detected, ` +
                `only the first ${MAX_MONITORS} will get per-monitor overrides`
            );
        }

        const count = Math.min(monitors.length, MAX_MONITORS);
        const rects = [];
        const r = [], g = [], b = [], rSat = [], gSat = [], bSat = [];

        for (let i = 0; i < count; i++) {
            const monitor = monitors[i];
            const connector = this._connectorForMonitor(monitor);
            const hasOverride = perMonitorEnabled && !!overrides[connector];
            const [mr, mg, mb, mrSat, mgSat, mbSat] = this._factorsForConnector(connector);

            console.log(
                `[DisplayColorCorrection] apply connector="${connector}" ` +
                `override=${hasOverride} r=${mr} g=${mg} b=${mb} rSat=${mrSat} gSat=${mgSat} bSat=${mbSat}`
            );

            rects.push(
                monitor.x / stageWidth, monitor.y / stageHeight,
                monitor.width / stageWidth, monitor.height / stageHeight
            );
            r.push(mr); g.push(mg); b.push(mb);
            rSat.push(mrSat); gSat.push(mgSat); bSat.push(mbSat);
        }

        // Riempi gli slot inutilizzati con valori neutri: monitor_count
        // esclude comunque questi indici dal loop nello shader, ma gli
        // array uniform devono restare completamente popolati.
        for (let i = count; i < MAX_MONITORS; i++) {
            rects.push(0, 0, 0, 0);
            r.push(1); g.push(1); b.push(1);
            rSat.push(1); gSat.push(1); bSat.push(1);
        }

        if (this._effect)
            setMonitors(this._effect, count, rects, r, g, b, rSat, gSat, bSat);
    }

    disable() {
        this._settings?.disconnectObject(this);
        Main.layoutManager.disconnectObject(this);
        if (this._clone) {
            global.stage.remove_child(this._clone);
            this._clone.destroy();
            this._clone = null;
        }
        this._effect = null;
        this._settings = null;
        console.log('[DisplayColorCorrection] Effect removed');
    }
}
