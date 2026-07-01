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
    _effect = null;
    _settings = null;
    _settingsChangedId = 0;
    _clone = null;
    _sizeConstraint = null;

    enable() {
        try {
            this._settings = this.getSettings(
                'org.gnome.shell.extensions.display-color-correct'
            );
            this._effect = new ColorCorrectionEffect();
            this._applySettings();
            this._settingsChangedId = this._settings.connect(
                'changed', () => this._applySettings()
            );

            // NON applichiamo l'effect direttamente a Main.layoutManager.uiGroup.
            // uiGroup è l'actor "vivo" che Mutter rilayouta continuamente
            // durante drag/resize delle finestre tra ClutterStageView diverse
            // (una per monitor). Un ClutterEffect offscreen (Shell.GLSLEffect)
            // applicato lì entra in conflitto con quel ciclo di relayout e
            // causa artefatti visivi (flash bianchi) quando una finestra
            // attraversa il confine tra due monitor.
            //
            // La soluzione, documentata nella discussione Mutter MR !2269
            // (gitlab.gnome.org/GNOME/mutter/-/merge_requests/2269) e usata
            // da altre estensioni di color-filtering full-screen (es.
            // gnome-colorblind-filters), è applicare l'effect a un
            // Clutter.Clone di uiGroup, non all'originale. L'originale
            // continua a essere gestito dal normale pipeline di Mutter
            // (relayout e clipped-redraws per-monitor invariati); il clone
            // è un nodo passivo che si limita a ridisegnare il contenuto
            // già renderizzato, quindi l'offscreen capture dell'effect non
            // interferisce più con il drag tra schermi.
            this._clone = new Clutter.Clone({
                source: Main.layoutManager.uiGroup,
                clip_to_allocation: true,
            });

            // Il clone è puramente visivo: i click/hover devono continuare
            // a raggiungere gli actor reali sotto di lui.
            Shell.util_set_hidden_from_pick(this._clone, true);

            // Tiene il clone sempre della stessa dimensione dello stage
            // (copre tutti i monitor combinati), anche su hotplug/resize.
            this._sizeConstraint = new Clutter.BindConstraint({
                source: global.stage,
                coordinate: Clutter.BindCoordinate.SIZE,
            });
            this._clone.add_constraint(this._sizeConstraint);

            this._clone.add_effect(this._effect);
            global.stage.add_child(this._clone);

            console.log('[DisplayColorCorrection] Effect applied');
        } catch (e) {
            console.error('[DisplayColorCorrection] Error:', e.message);
        }
    }

    _applySettings() {
        const r    = this._settings.get_double('red-factor');
        const g    = this._settings.get_double('green-factor');
        const b    = this._settings.get_double('blue-factor');
        const rSat = this._settings.get_double('red-saturation');
        const gSat = this._settings.get_double('green-saturation');
        const bSat = this._settings.get_double('blue-saturation');
        this._effect?.setFactors(r, g, b, rSat, gSat, bSat);
    }

    disable() {
        if (this._settingsChangedId) {
            this._settings?.disconnect(this._settingsChangedId);
            this._settingsChangedId = 0;
        }
        if (this._clone) {
            global.stage.remove_child(this._clone);
            this._clone.destroy();
            this._clone = null;
        }
        this._sizeConstraint = null;
        this._effect = null;
        this._settings = null;
        console.log('[DisplayColorCorrection] Effect removed');
    }
}