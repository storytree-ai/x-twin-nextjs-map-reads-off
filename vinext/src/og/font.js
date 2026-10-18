// The built-in font for next/og text: the classic 5x7 bitmap font for
// printable ASCII, each glyph five columns of seven bits (bit 0 at the top).
// vinext ships no font files, so every fontFamily draws with this one.

const GLYPHS =
  "0000000000" + "00005f0000" + "0007000700" + "147f147f14" + "242a7f2a12" + "2313086462" + "3649552250" + "0005030000" +
  "001c224100" + "0041221c00" + "082a1c2a08" + "08083e0808" + "0050300000" + "0808080808" + "0060600000" + "2010080402" +
  "3e5149453e" + "00427f4000" + "4261514946" + "2141454b31" + "1814127f10" + "2745454539" + "3c4a494930" + "0171090503" +
  "3649494936" + "064949291e" + "0036360000" + "0056360000" + "0008142241" + "1414141414" + "4122140800" + "0201510906" +
  "3249794132" + "7e1111117e" + "7f49494936" + "3e41414122" + "7f4141221c" + "7f49494941" + "7f09090101" + "3e41415132" +
  "7f0808087f" + "00417f4100" + "2040413f01" + "7f08142241" + "7f40404040" + "7f0204027f" + "7f0408107f" + "3e4141413e" +
  "7f09090906" + "3e4151215e" + "7f09192946" + "4649494931" + "01017f0101" + "3f4040403f" + "1f2040201f" + "7f2018207f" +
  "6314081463" + "0304780403" + "6151494543" + "00007f4141" + "0204081020" + "41417f0000" + "0402010204" + "4040404040" +
  "0001020400" + "2054545478" + "7f48444438" + "3844444420" + "384444487f" + "3854545418" + "087e090102" + "081454543c" +
  "7f08040478" + "00447d4000" + "2040443d00" + "007f102844" + "00417f4000" + "7c04180478" + "7c08040478" + "3844444438" +
  "7c14141408" + "081414187c" + "7c08040408" + "4854545420" + "043f444020" + "3c4040207c" + "1c2040201c" + "3c4030403c" +
  "4428102844" + "0c5050503c" + "4464544c44" + "0008364100" + "00007f0000" + "0041360800" + "0804081008";

// Drawn for characters the font has no glyph for: a hollow box.
const MISSING = [0x7f, 0x41, 0x41, 0x41, 0x7f];

/** The five column bitmasks of a character's glyph. */
export function glyph(ch) {
  const code = ch.codePointAt(0);
  if (code < 32 || code > 126) return MISSING;
  const at = (code - 32) * 10;
  const cols = [];
  for (let i = 0; i < 5; i++) cols.push(parseInt(GLYPHS.slice(at + i * 2, at + i * 2 + 2), 16));
  return cols;
}

// Font metrics in em: a glyph cell is 6 columns (5 drawn and one gap) and
// 7 rows on a grid of fontSize / 8, sitting on a 1.2em line.
export const PIXEL_EM = 1 / 8;
export const ADVANCE_EM = 6 * PIXEL_EM;
export const LINE_HEIGHT_EM = 1.2;
