# Display Color Correction

A GNOME Shell extension that applies per-channel brightness and saturation corrections to the entire display via a GLSL shader. Useful for taming oversaturated OLED panels (e.g. ASUS Zenbook).

- **UUID:** `display-color-correct@antoniopicone.it`
- **GNOME Shell:** 48, 49, 50

## How it works

The extension hooks a fragment shader onto GNOME Shell's compositor (`Main.layoutManager.uiGroup`). The shader applies two independent corrections per RGB channel:

1. **Brightness** — multiply the channel value by a factor (`1.0` = unchanged, lower = darker).
2. **Saturation** — blend the channel toward luminance using a factor (`1.0` = unchanged, `0.0` = greyscale, `>1.0` = more saturated).

Luminance is computed with the standard ITU-R BT.709 coefficients (`0.2126 R + 0.7152 G + 0.0722 B`).

## Settings

All values are stored in GSettings under `org.gnome.shell.extensions.display-color-correct`.

| Key | Default | Range | Description |
|---|---|---|---|
| `red-factor` | `1.0` | 0.1 – 1.0 | Red channel brightness |
| `green-factor` | `1.0` | 0.1 – 1.0 | Green channel brightness |
| `blue-factor` | `1.0` | 0.1 – 1.0 | Blue channel brightness |
| `red-saturation` | `1.0` | 0.0 – 2.0 | Red channel saturation |
| `green-saturation` | `1.0` | 0.0 – 2.0 | Green channel saturation |
| `blue-saturation` | `1.0` | 0.0 – 2.0 | Blue channel saturation |
| `monitor-overrides` | `{}` | — | JSON map of per-monitor overrides, keyed by connector name |
| `per-monitor-enabled` | `false` | — | Whether per-monitor overrides take effect |

All defaults start neutral (no correction applied). Adjust them in **Preferences** to suit your display — the **Defaults** tab applies to every monitor, and the **Per Monitor** tab lets you override individual monitors (e.g. tuning OLED oversaturation on one panel without affecting an external display).

## Installation

```bash
git clone https://github.com/antoniopicone/display-color-correct
cd display-color-correct
bash install.sh
```

`install.sh` copies the extension files, compiles the GSettings schema, and enables the extension. If automatic enabling fails (e.g. on Wayland before a session restart), log out and back in, then enable **Display Color Correction** in **Extension Manager** or via:

```bash
gnome-extensions enable display-color-correct@antoniopicone.it
```

## Preferences

Open the preferences window from **Extension Manager** or:

```bash
gnome-extensions prefs display-color-correct@antoniopicone.it
```

The preferences window has two tabs:

- **Defaults** — brightness and saturation sliders per channel, applied to every monitor (greyed out while per-monitor overrides are enabled).
- **Per Monitor** — a switch to enable per-monitor overrides; when on, pick a monitor from the dropdown and customize its 6 values independently, or reset it back to the defaults.

All sliders give a live preview as you drag.

## Files

| File | Purpose |
|---|---|
| [extension.js](extension.js) | Core extension: registers the `ColorCorrectionEffect` GLSL effect and wires it to GSettings |
| [prefs.js](prefs.js) | Preferences UI built with Adwaita/GTK4 |
| [metadata.json](metadata.json) | Extension metadata (UUID, supported GNOME versions) |
| [install.sh](install.sh) | Install script |
| [schemas/](schemas/) | GSettings schema XML |

## License

MIT
