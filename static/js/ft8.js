/**
 * HamSCI PSWS Contesting Dashboard - FT8 / FT4 decoder (ft8.js)
 *
 * Decodes FT8 and FT4 from the click-to-listen audio (12 kHz mono, USB on a
 * band's FT8/FT4 dial) in the browser, one 15 s / 7.5 s UTC slot at a time.
 *
 * This is a JavaScript port of the decoder in ft8_lib by Kārlis Goba
 * (https://github.com/kgoba/ft8_lib), the same library the station's
 * decode_ft8 is built from: STFT waterfall (Hann window, 2x time and 2x
 * frequency oversampling, 0.5 dB uint8 cells), Costas sync search, Gray-
 * mapped soft bits, LDPC(174,91) belief propagation, CRC-14 and 77-bit
 * message unpacking.  The LDPC and CRC tables are copied verbatim from its
 * constants.c.  Additions over the port: SNR (2500 Hz) and DT estimates like
 * WSJT-X, the WSJT-X call hashes (so <...> becomes a call once seen), an
 * encoder (used by the tests) and FtxReceiver, which slices live audio into
 * UTC slots.
 *
 * ft8_lib is MIT licensed:
 *
 *   Copyright (c) 2018 Kārlis Goba
 *
 *   Permission is hereby granted, free of charge, to any person obtaining a
 *   copy of this software and associated documentation files (the
 *   "Software"), to deal in the Software without restriction, including
 *   without limitation the rights to use, copy, modify, merge, publish,
 *   distribute, sublicense, and/or sell copies of the Software, and to
 *   permit persons to whom the Software is furnished to do so, subject to
 *   the following conditions:
 *
 *   The above copyright notice and this permission notice shall be included
 *   in all copies or substantial portions of the Software.
 *
 *   THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS
 *   OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
 *   MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT.
 *   IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY
 *   CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT,
 *   TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE
 *   SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
 *
 * Works in the browser (window.FT8) and in Node (tests/ft8.test.js).
 */

const FT8 = (() => {
  // ── Protocol constants (ft8_lib constants.h) ──────────────────────────────
  const PROTO = {
    ft8: { name: "FT8", period: 0.160, slot: 15.0, nn: 79, nd: 58, tones: 8, bits: 3 },
    ft4: { name: "FT4", period: 0.048, slot: 7.5, nn: 105, nd: 87, tones: 4, bits: 2 },
  };
  const LDPC_N = 174, LDPC_K = 91, LDPC_M = 83;
  const CRC_POLY = 0x2757, CRC_WIDTH = 14, CRC_TOP = 1 << (CRC_WIDTH - 1);
  const NTOKENS = 2063592, MAX22 = 4194304, MAXGRID4 = 32400;
  // A signal is nominally keyed 0.5 s after the slot boundary (WSJT-X); DT
  // is reported relative to that.
  const T_NOMINAL = 0.5;

  // ── Tables, verbatim from ft8_lib constants.c ─────────────────────────────
  const GEN = [
  [0x83, 0x29, 0xce, 0x11, 0xbf, 0x31, 0xea, 0xf5, 0x09, 0xf2, 0x7f, 0xc0],
  [0x76, 0x1c, 0x26, 0x4e, 0x25, 0xc2, 0x59, 0x33, 0x54, 0x93, 0x13, 0x20],
  [0xdc, 0x26, 0x59, 0x02, 0xfb, 0x27, 0x7c, 0x64, 0x10, 0xa1, 0xbd, 0xc0],
  [0x1b, 0x3f, 0x41, 0x78, 0x58, 0xcd, 0x2d, 0xd3, 0x3e, 0xc7, 0xf6, 0x20],
  [0x09, 0xfd, 0xa4, 0xfe, 0xe0, 0x41, 0x95, 0xfd, 0x03, 0x47, 0x83, 0xa0],
  [0x07, 0x7c, 0xcc, 0xc1, 0x1b, 0x88, 0x73, 0xed, 0x5c, 0x3d, 0x48, 0xa0],
  [0x29, 0xb6, 0x2a, 0xfe, 0x3c, 0xa0, 0x36, 0xf4, 0xfe, 0x1a, 0x9d, 0xa0],
  [0x60, 0x54, 0xfa, 0xf5, 0xf3, 0x5d, 0x96, 0xd3, 0xb0, 0xc8, 0xc3, 0xe0],
  [0xe2, 0x07, 0x98, 0xe4, 0x31, 0x0e, 0xed, 0x27, 0x88, 0x4a, 0xe9, 0x00],
  [0x77, 0x5c, 0x9c, 0x08, 0xe8, 0x0e, 0x26, 0xdd, 0xae, 0x56, 0x31, 0x80],
  [0xb0, 0xb8, 0x11, 0x02, 0x8c, 0x2b, 0xf9, 0x97, 0x21, 0x34, 0x87, 0xc0],
  [0x18, 0xa0, 0xc9, 0x23, 0x1f, 0xc6, 0x0a, 0xdf, 0x5c, 0x5e, 0xa3, 0x20],
  [0x76, 0x47, 0x1e, 0x83, 0x02, 0xa0, 0x72, 0x1e, 0x01, 0xb1, 0x2b, 0x80],
  [0xff, 0xbc, 0xcb, 0x80, 0xca, 0x83, 0x41, 0xfa, 0xfb, 0x47, 0xb2, 0xe0],
  [0x66, 0xa7, 0x2a, 0x15, 0x8f, 0x93, 0x25, 0xa2, 0xbf, 0x67, 0x17, 0x00],
  [0xc4, 0x24, 0x36, 0x89, 0xfe, 0x85, 0xb1, 0xc5, 0x13, 0x63, 0xa1, 0x80],
  [0x0d, 0xff, 0x73, 0x94, 0x14, 0xd1, 0xa1, 0xb3, 0x4b, 0x1c, 0x27, 0x00],
  [0x15, 0xb4, 0x88, 0x30, 0x63, 0x6c, 0x8b, 0x99, 0x89, 0x49, 0x72, 0xe0],
  [0x29, 0xa8, 0x9c, 0x0d, 0x3d, 0xe8, 0x1d, 0x66, 0x54, 0x89, 0xb0, 0xe0],
  [0x4f, 0x12, 0x6f, 0x37, 0xfa, 0x51, 0xcb, 0xe6, 0x1b, 0xd6, 0xb9, 0x40],
  [0x99, 0xc4, 0x72, 0x39, 0xd0, 0xd9, 0x7d, 0x3c, 0x84, 0xe0, 0x94, 0x00],
  [0x19, 0x19, 0xb7, 0x51, 0x19, 0x76, 0x56, 0x21, 0xbb, 0x4f, 0x1e, 0x80],
  [0x09, 0xdb, 0x12, 0xd7, 0x31, 0xfa, 0xee, 0x0b, 0x86, 0xdf, 0x6b, 0x80],
  [0x48, 0x8f, 0xc3, 0x3d, 0xf4, 0x3f, 0xbd, 0xee, 0xa4, 0xea, 0xfb, 0x40],
  [0x82, 0x74, 0x23, 0xee, 0x40, 0xb6, 0x75, 0xf7, 0x56, 0xeb, 0x5f, 0xe0],
  [0xab, 0xe1, 0x97, 0xc4, 0x84, 0xcb, 0x74, 0x75, 0x71, 0x44, 0xa9, 0xa0],
  [0x2b, 0x50, 0x0e, 0x4b, 0xc0, 0xec, 0x5a, 0x6d, 0x2b, 0xdb, 0xdd, 0x00],
  [0xc4, 0x74, 0xaa, 0x53, 0xd7, 0x02, 0x18, 0x76, 0x16, 0x69, 0x36, 0x00],
  [0x8e, 0xba, 0x1a, 0x13, 0xdb, 0x33, 0x90, 0xbd, 0x67, 0x18, 0xce, 0xc0],
  [0x75, 0x38, 0x44, 0x67, 0x3a, 0x27, 0x78, 0x2c, 0xc4, 0x20, 0x12, 0xe0],
  [0x06, 0xff, 0x83, 0xa1, 0x45, 0xc3, 0x70, 0x35, 0xa5, 0xc1, 0x26, 0x80],
  [0x3b, 0x37, 0x41, 0x78, 0x58, 0xcc, 0x2d, 0xd3, 0x3e, 0xc3, 0xf6, 0x20],
  [0x9a, 0x4a, 0x5a, 0x28, 0xee, 0x17, 0xca, 0x9c, 0x32, 0x48, 0x42, 0xc0],
  [0xbc, 0x29, 0xf4, 0x65, 0x30, 0x9c, 0x97, 0x7e, 0x89, 0x61, 0x0a, 0x40],
  [0x26, 0x63, 0xae, 0x6d, 0xdf, 0x8b, 0x5c, 0xe2, 0xbb, 0x29, 0x48, 0x80],
  [0x46, 0xf2, 0x31, 0xef, 0xe4, 0x57, 0x03, 0x4c, 0x18, 0x14, 0x41, 0x80],
  [0x3f, 0xb2, 0xce, 0x85, 0xab, 0xe9, 0xb0, 0xc7, 0x2e, 0x06, 0xfb, 0xe0],
  [0xde, 0x87, 0x48, 0x1f, 0x28, 0x2c, 0x15, 0x39, 0x71, 0xa0, 0xa2, 0xe0],
  [0xfc, 0xd7, 0xcc, 0xf2, 0x3c, 0x69, 0xfa, 0x99, 0xbb, 0xa1, 0x41, 0x20],
  [0xf0, 0x26, 0x14, 0x47, 0xe9, 0x49, 0x0c, 0xa8, 0xe4, 0x74, 0xce, 0xc0],
  [0x44, 0x10, 0x11, 0x58, 0x18, 0x19, 0x6f, 0x95, 0xcd, 0xd7, 0x01, 0x20],
  [0x08, 0x8f, 0xc3, 0x1d, 0xf4, 0xbf, 0xbd, 0xe2, 0xa4, 0xea, 0xfb, 0x40],
  [0xb8, 0xfe, 0xf1, 0xb6, 0x30, 0x77, 0x29, 0xfb, 0x0a, 0x07, 0x8c, 0x00],
  [0x5a, 0xfe, 0xa7, 0xac, 0xcc, 0xb7, 0x7b, 0xbc, 0x9d, 0x99, 0xa9, 0x00],
  [0x49, 0xa7, 0x01, 0x6a, 0xc6, 0x53, 0xf6, 0x5e, 0xcd, 0xc9, 0x07, 0x60],
  [0x19, 0x44, 0xd0, 0x85, 0xbe, 0x4e, 0x7d, 0xa8, 0xd6, 0xcc, 0x7d, 0x00],
  [0x25, 0x1f, 0x62, 0xad, 0xc4, 0x03, 0x2f, 0x0e, 0xe7, 0x14, 0x00, 0x20],
  [0x56, 0x47, 0x1f, 0x87, 0x02, 0xa0, 0x72, 0x1e, 0x00, 0xb1, 0x2b, 0x80],
  [0x2b, 0x8e, 0x49, 0x23, 0xf2, 0xdd, 0x51, 0xe2, 0xd5, 0x37, 0xfa, 0x00],
  [0x6b, 0x55, 0x0a, 0x40, 0xa6, 0x6f, 0x47, 0x55, 0xde, 0x95, 0xc2, 0x60],
  [0xa1, 0x8a, 0xd2, 0x8d, 0x4e, 0x27, 0xfe, 0x92, 0xa4, 0xf6, 0xc8, 0x40],
  [0x10, 0xc2, 0xe5, 0x86, 0x38, 0x8c, 0xb8, 0x2a, 0x3d, 0x80, 0x75, 0x80],
  [0xef, 0x34, 0xa4, 0x18, 0x17, 0xee, 0x02, 0x13, 0x3d, 0xb2, 0xeb, 0x00],
  [0x7e, 0x9c, 0x0c, 0x54, 0x32, 0x5a, 0x9c, 0x15, 0x83, 0x6e, 0x00, 0x00],
  [0x36, 0x93, 0xe5, 0x72, 0xd1, 0xfd, 0xe4, 0xcd, 0xf0, 0x79, 0xe8, 0x60],
  [0xbf, 0xb2, 0xce, 0xc5, 0xab, 0xe1, 0xb0, 0xc7, 0x2e, 0x07, 0xfb, 0xe0],
  [0x7e, 0xe1, 0x82, 0x30, 0xc5, 0x83, 0xcc, 0xcc, 0x57, 0xd4, 0xb0, 0x80],
  [0xa0, 0x66, 0xcb, 0x2f, 0xed, 0xaf, 0xc9, 0xf5, 0x26, 0x64, 0x12, 0x60],
  [0xbb, 0x23, 0x72, 0x5a, 0xbc, 0x47, 0xcc, 0x5f, 0x4c, 0xc4, 0xcd, 0x20],
  [0xde, 0xd9, 0xdb, 0xa3, 0xbe, 0xe4, 0x0c, 0x59, 0xb5, 0x60, 0x9b, 0x40],
  [0xd9, 0xa7, 0x01, 0x6a, 0xc6, 0x53, 0xe6, 0xde, 0xcd, 0xc9, 0x03, 0x60],
  [0x9a, 0xd4, 0x6a, 0xed, 0x5f, 0x70, 0x7f, 0x28, 0x0a, 0xb5, 0xfc, 0x40],
  [0xe5, 0x92, 0x1c, 0x77, 0x82, 0x25, 0x87, 0x31, 0x6d, 0x7d, 0x3c, 0x20],
  [0x4f, 0x14, 0xda, 0x82, 0x42, 0xa8, 0xb8, 0x6d, 0xca, 0x73, 0x35, 0x20],
  [0x8b, 0x8b, 0x50, 0x7a, 0xd4, 0x67, 0xd4, 0x44, 0x1d, 0xf7, 0x70, 0xe0],
  [0x22, 0x83, 0x1c, 0x9c, 0xf1, 0x16, 0x94, 0x67, 0xad, 0x04, 0xb6, 0x80],
  [0x21, 0x3b, 0x83, 0x8f, 0xe2, 0xae, 0x54, 0xc3, 0x8e, 0xe7, 0x18, 0x00],
  [0x5d, 0x92, 0x6b, 0x6d, 0xd7, 0x1f, 0x08, 0x51, 0x81, 0xa4, 0xe1, 0x20],
  [0x66, 0xab, 0x79, 0xd4, 0xb2, 0x9e, 0xe6, 0xe6, 0x95, 0x09, 0xe5, 0x60],
  [0x95, 0x81, 0x48, 0x68, 0x2d, 0x74, 0x8a, 0x38, 0xdd, 0x68, 0xba, 0xa0],
  [0xb8, 0xce, 0x02, 0x0c, 0xf0, 0x69, 0xc3, 0x2a, 0x72, 0x3a, 0xb1, 0x40],
  [0xf4, 0x33, 0x1d, 0x6d, 0x46, 0x16, 0x07, 0xe9, 0x57, 0x52, 0x74, 0x60],
  [0x6d, 0xa2, 0x3b, 0xa4, 0x24, 0xb9, 0x59, 0x61, 0x33, 0xcf, 0x9c, 0x80],
  [0xa6, 0x36, 0xbc, 0xbc, 0x7b, 0x30, 0xc5, 0xfb, 0xea, 0xe6, 0x7f, 0xe0],
  [0x5c, 0xb0, 0xd8, 0x6a, 0x07, 0xdf, 0x65, 0x4a, 0x90, 0x89, 0xa2, 0x00],
  [0xf1, 0x1f, 0x10, 0x68, 0x48, 0x78, 0x0f, 0xc9, 0xec, 0xdd, 0x80, 0xa0],
  [0x1f, 0xbb, 0x53, 0x64, 0xfb, 0x8d, 0x2c, 0x9d, 0x73, 0x0d, 0x5b, 0xa0],
  [0xfc, 0xb8, 0x6b, 0xc7, 0x0a, 0x50, 0xc9, 0xd0, 0x2a, 0x5d, 0x03, 0x40],
  [0xa5, 0x34, 0x43, 0x30, 0x29, 0xea, 0xc1, 0x5f, 0x32, 0x2e, 0x34, 0xc0],
  [0xc9, 0x89, 0xd9, 0xc7, 0xc3, 0xd3, 0xb8, 0xc5, 0x5d, 0x75, 0x13, 0x00],
  [0x7b, 0xb3, 0x8b, 0x2f, 0x01, 0x86, 0xd4, 0x66, 0x43, 0xae, 0x96, 0x20],
  [0x26, 0x44, 0xeb, 0xad, 0xeb, 0x44, 0xb9, 0x46, 0x7d, 0x1f, 0x42, 0xc0],
  [0x60, 0x8c, 0xc8, 0x57, 0x59, 0x4b, 0xfb, 0xb5, 0x5d, 0x69, 0x60, 0x00]
];
  const NM = [
  [4, 31, 59, 91, 92, 96, 153],
  [5, 32, 60, 93, 115, 146, 0],
  [6, 24, 61, 94, 122, 151, 0],
  [7, 33, 62, 95, 96, 143, 0],
  [8, 25, 63, 83, 93, 96, 148],
  [6, 32, 64, 97, 126, 138, 0],
  [5, 34, 65, 78, 98, 107, 154],
  [9, 35, 66, 99, 139, 146, 0],
  [10, 36, 67, 100, 107, 126, 0],
  [11, 37, 67, 87, 101, 139, 158],
  [12, 38, 68, 102, 105, 155, 0],
  [13, 39, 69, 103, 149, 162, 0],
  [8, 40, 70, 82, 104, 114, 145],
  [14, 41, 71, 88, 102, 123, 156],
  [15, 42, 59, 106, 123, 159, 0],
  [1, 33, 72, 106, 107, 157, 0],
  [16, 43, 73, 108, 141, 160, 0],
  [17, 37, 74, 81, 109, 131, 154],
  [11, 44, 75, 110, 121, 166, 0],
  [45, 55, 64, 111, 130, 161, 173],
  [8, 46, 71, 112, 119, 166, 0],
  [18, 36, 76, 89, 113, 114, 143],
  [19, 38, 77, 104, 116, 163, 0],
  [20, 47, 70, 92, 138, 165, 0],
  [2, 48, 74, 113, 128, 160, 0],
  [21, 45, 78, 83, 117, 121, 151],
  [22, 47, 58, 118, 127, 164, 0],
  [16, 39, 62, 112, 134, 158, 0],
  [23, 43, 79, 120, 131, 145, 0],
  [19, 35, 59, 73, 110, 125, 161],
  [20, 36, 63, 94, 136, 161, 0],
  [14, 31, 79, 98, 132, 164, 0],
  [3, 44, 80, 124, 127, 169, 0],
  [19, 46, 81, 117, 135, 167, 0],
  [7, 49, 58, 90, 100, 105, 168],
  [12, 50, 61, 118, 119, 144, 0],
  [13, 51, 64, 114, 118, 157, 0],
  [24, 52, 76, 129, 148, 149, 0],
  [25, 53, 69, 90, 101, 130, 156],
  [20, 46, 65, 80, 120, 140, 170],
  [21, 54, 77, 100, 140, 171, 0],
  [35, 82, 133, 142, 171, 174, 0],
  [14, 30, 83, 113, 125, 170, 0],
  [4, 29, 68, 120, 134, 173, 0],
  [1, 4, 52, 57, 86, 136, 152],
  [26, 51, 56, 91, 122, 137, 168],
  [52, 84, 110, 115, 145, 168, 0],
  [7, 50, 81, 99, 132, 173, 0],
  [23, 55, 67, 95, 172, 174, 0],
  [26, 41, 77, 109, 141, 148, 0],
  [2, 27, 41, 61, 62, 115, 133],
  [27, 40, 56, 124, 125, 126, 0],
  [18, 49, 55, 124, 141, 167, 0],
  [6, 33, 85, 108, 116, 156, 0],
  [28, 48, 70, 85, 105, 129, 158],
  [9, 54, 63, 131, 147, 155, 0],
  [22, 53, 68, 109, 121, 174, 0],
  [3, 13, 48, 78, 95, 123, 0],
  [31, 69, 133, 150, 155, 169, 0],
  [12, 43, 66, 89, 97, 135, 159],
  [5, 39, 75, 102, 136, 167, 0],
  [2, 54, 86, 101, 135, 164, 0],
  [15, 56, 87, 108, 119, 171, 0],
  [10, 44, 82, 91, 111, 144, 149],
  [23, 34, 71, 94, 127, 153, 0],
  [11, 49, 88, 92, 142, 157, 0],
  [29, 34, 87, 97, 147, 162, 0],
  [30, 50, 60, 86, 137, 142, 162],
  [10, 53, 66, 84, 112, 128, 165],
  [22, 57, 85, 93, 140, 159, 0],
  [28, 32, 72, 103, 132, 166, 0],
  [28, 29, 84, 88, 117, 143, 150],
  [1, 26, 45, 80, 128, 147, 0],
  [17, 27, 89, 103, 116, 153, 0],
  [51, 57, 98, 163, 165, 172, 0],
  [21, 37, 73, 138, 152, 169, 0],
  [16, 47, 76, 130, 137, 154, 0],
  [3, 24, 30, 72, 104, 139, 0],
  [9, 40, 90, 106, 134, 151, 0],
  [15, 58, 60, 74, 111, 150, 163],
  [18, 42, 79, 144, 146, 152, 0],
  [25, 38, 65, 99, 122, 160, 0],
  [17, 42, 75, 129, 170, 172, 0]
];
  const MN = [
  [16, 45, 73],
  [25, 51, 62],
  [33, 58, 78],
  [1, 44, 45],
  [2, 7, 61],
  [3, 6, 54],
  [4, 35, 48],
  [5, 13, 21],
  [8, 56, 79],
  [9, 64, 69],
  [10, 19, 66],
  [11, 36, 60],
  [12, 37, 58],
  [14, 32, 43],
  [15, 63, 80],
  [17, 28, 77],
  [18, 74, 83],
  [22, 53, 81],
  [23, 30, 34],
  [24, 31, 40],
  [26, 41, 76],
  [27, 57, 70],
  [29, 49, 65],
  [3, 38, 78],
  [5, 39, 82],
  [46, 50, 73],
  [51, 52, 74],
  [55, 71, 72],
  [44, 67, 72],
  [43, 68, 78],
  [1, 32, 59],
  [2, 6, 71],
  [4, 16, 54],
  [7, 65, 67],
  [8, 30, 42],
  [9, 22, 31],
  [10, 18, 76],
  [11, 23, 82],
  [12, 28, 61],
  [13, 52, 79],
  [14, 50, 51],
  [15, 81, 83],
  [17, 29, 60],
  [19, 33, 64],
  [20, 26, 73],
  [21, 34, 40],
  [24, 27, 77],
  [25, 55, 58],
  [35, 53, 66],
  [36, 48, 68],
  [37, 46, 75],
  [38, 45, 47],
  [39, 57, 69],
  [41, 56, 62],
  [20, 49, 53],
  [46, 52, 63],
  [45, 70, 75],
  [27, 35, 80],
  [1, 15, 30],
  [2, 68, 80],
  [3, 36, 51],
  [4, 28, 51],
  [5, 31, 56],
  [6, 20, 37],
  [7, 40, 82],
  [8, 60, 69],
  [9, 10, 49],
  [11, 44, 57],
  [12, 39, 59],
  [13, 24, 55],
  [14, 21, 65],
  [16, 71, 78],
  [17, 30, 76],
  [18, 25, 80],
  [19, 61, 83],
  [22, 38, 77],
  [23, 41, 50],
  [7, 26, 58],
  [29, 32, 81],
  [33, 40, 73],
  [18, 34, 48],
  [13, 42, 64],
  [5, 26, 43],
  [47, 69, 72],
  [54, 55, 70],
  [45, 62, 68],
  [10, 63, 67],
  [14, 66, 72],
  [22, 60, 74],
  [35, 39, 79],
  [1, 46, 64],
  [1, 24, 66],
  [2, 5, 70],
  [3, 31, 65],
  [4, 49, 58],
  [1, 4, 5],
  [6, 60, 67],
  [7, 32, 75],
  [8, 48, 82],
  [9, 35, 41],
  [10, 39, 62],
  [11, 14, 61],
  [12, 71, 74],
  [13, 23, 78],
  [11, 35, 55],
  [15, 16, 79],
  [7, 9, 16],
  [17, 54, 63],
  [18, 50, 57],
  [19, 30, 47],
  [20, 64, 80],
  [21, 28, 69],
  [22, 25, 43],
  [13, 22, 37],
  [2, 47, 51],
  [23, 54, 74],
  [26, 34, 72],
  [27, 36, 37],
  [21, 36, 63],
  [29, 40, 44],
  [19, 26, 57],
  [3, 46, 82],
  [14, 15, 58],
  [33, 52, 53],
  [30, 43, 52],
  [6, 9, 52],
  [27, 33, 65],
  [25, 69, 73],
  [38, 55, 83],
  [20, 39, 77],
  [18, 29, 56],
  [32, 48, 71],
  [42, 51, 59],
  [28, 44, 79],
  [34, 60, 62],
  [31, 45, 61],
  [46, 68, 77],
  [6, 24, 76],
  [8, 10, 78],
  [40, 41, 70],
  [17, 50, 53],
  [42, 66, 68],
  [4, 22, 72],
  [36, 64, 81],
  [13, 29, 47],
  [2, 8, 81],
  [56, 67, 73],
  [5, 38, 50],
  [12, 38, 64],
  [59, 72, 80],
  [3, 26, 79],
  [45, 76, 81],
  [1, 65, 74],
  [7, 18, 77],
  [11, 56, 59],
  [14, 39, 54],
  [16, 37, 66],
  [10, 28, 55],
  [15, 60, 70],
  [17, 25, 82],
  [20, 30, 31],
  [12, 67, 68],
  [23, 75, 80],
  [27, 32, 62],
  [24, 69, 75],
  [19, 21, 71],
  [34, 53, 61],
  [35, 46, 47],
  [33, 59, 76],
  [40, 43, 83],
  [41, 42, 63],
  [49, 75, 83],
  [20, 44, 48],
  [42, 49, 57]
];
  const NUM_ROWS = [7, 6, 6, 6, 7, 6, 7, 6, 6, 7, 6, 6, 7, 7, 6, 6, 6, 7, 6, 7, 6, 7, 6, 6, 6, 7, 6, 6, 6, 7, 6, 6, 6, 6, 7, 6, 6, 6, 7, 7, 6, 6, 6, 6, 7, 7, 6, 6, 6, 6, 7, 6, 6, 6, 7, 6, 6, 6, 6, 7, 6, 6, 6, 7, 6, 6, 6, 7, 7, 6, 6, 7, 6, 6, 6, 6, 6, 6, 6, 7, 6, 6, 6];
  const FT8_COSTAS = [3, 1, 4, 0, 6, 5, 2];
  const FT4_COSTAS = [
  [0, 1, 3, 2],
  [1, 0, 2, 3],
  [2, 3, 1, 0],
  [3, 2, 0, 1]
];
  const FT8_GRAY = [0, 1, 3, 2, 5, 6, 4, 7];
  const FT4_GRAY = [0, 1, 3, 2];
  const FT4_XOR = [0x4A, 0x5E, 0x89, 0xB4, 0xB0, 0x8A, 0x79, 0x55, 0xBE, 0x28];

  // ── Text helpers (text.c) ─────────────────────────────────────────────────
  // charn(): integer index -> character for one of six alphabets.
  function charn(c, table) {
    if (table !== 2 && table !== 3) { if (c === 0) return " "; c -= 1; }
    if (table !== 4) { if (c < 10) return String.fromCharCode(48 + c); c -= 10; }
    if (table !== 3) { if (c < 26) return String.fromCharCode(65 + c); c -= 26; }
    if (table === 0) { if (c < 5) return "+-./?"[c]; }
    else if (table === 5) { if (c === 0) return "/"; }
    return "_";
  }
  const A0 = " 0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ+-./?";
  const A1 = " 0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  const A2 = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  const A3 = "0123456789";
  const A4 = " ABCDEFGHIJKLMNOPQRSTUVWXYZ";

  function intToDd(value, width, fullSign) {
    let s = "";
    if (value < 0) { s = "-"; value = -value; } else if (fullSign) s = "+";
    return s + String(value).padStart(width, "0").slice(-width);
  }

  function ddToInt(str, length) {
    let i = 0, neg = false, r = 0;
    if (str[0] === "-") { neg = true; i = 1; } else if (str[0] === "+") i = 1;
    for (; i < length && i < str.length && str[i] >= "0" && str[i] <= "9"; i++) r = r * 10 + (str.charCodeAt(i) - 48);
    return neg ? -r : r;
  }

  // ── CRC-14 (crc.c) ────────────────────────────────────────────────────────
  function computeCrc(bytes, numBits) {
    let rem = 0, idx = 0;
    for (let bit = 0; bit < numBits; bit++) {
      if (bit % 8 === 0) rem ^= bytes[idx++] << (CRC_WIDTH - 8);
      rem = (rem & CRC_TOP) ? ((rem << 1) ^ CRC_POLY) : (rem << 1);
      rem &= 0xffff;
    }
    return rem & ((CRC_TOP << 1) - 1);
  }
  const extractCrc = a91 => ((a91[9] & 0x07) << 11) | (a91[10] << 3) | (a91[11] >> 5);

  function addCrc(payload) {
    const a91 = new Uint8Array(12);
    for (let i = 0; i < 10; i++) a91[i] = payload[i];
    a91[9] &= 0xf8; a91[10] = 0;
    const c = computeCrc(a91, 96 - 14);
    a91[9] |= (c >> 11) & 0xff; a91[10] = (c >> 3) & 0xff; a91[11] = (c << 5) & 0xff;
    return a91;
  }

  // ── LDPC belief propagation (ldpc.c bp_decode) ────────────────────────────
  function fastTanh(x) {
    if (x < -4.97) return -1;
    if (x > 4.97) return 1;
    const x2 = x * x;
    return x * (945 + x2 * (105 + x2)) / (945 + x2 * (420 + x2 * 15));
  }
  function fastAtanh(x) {
    const x2 = x * x;
    return x * (945 + x2 * (-735 + x2 * 64)) / (945 + x2 * (-1050 + x2 * 225));
  }
  function ldpcCheck(cw) {
    let errors = 0;
    for (let m = 0; m < LDPC_M; m++) {
      let x = 0;
      for (let i = 0; i < NUM_ROWS[m]; i++) x ^= cw[NM[m][i] - 1];
      if (x) errors++;
    }
    return errors;
  }
  const tov = new Float32Array(LDPC_N * 3), toc = new Float32Array(LDPC_M * 7);
  /** Returns the number of parity errors left (0 = valid codeword) in plain. */
  function bpDecode(codeword, maxIters, plain) {
    let minErrors = LDPC_M;
    tov.fill(0);
    for (let iter = 0; iter < maxIters; iter++) {
      let sum = 0;
      for (let n = 0; n < LDPC_N; n++) {
        plain[n] = (codeword[n] + tov[n * 3] + tov[n * 3 + 1] + tov[n * 3 + 2]) > 0 ? 1 : 0;
        sum += plain[n];
      }
      if (sum === 0) break;                          // all-zero is not a valid message
      const errors = ldpcCheck(plain);
      if (errors < minErrors) { minErrors = errors; if (errors === 0) break; }
      for (let m = 0; m < LDPC_M; m++) {
        for (let ni = 0; ni < NUM_ROWS[m]; ni++) {
          const n = NM[m][ni] - 1;
          let t = codeword[n];
          for (let mi = 0; mi < 3; mi++) if (MN[n][mi] - 1 !== m) t += tov[n * 3 + mi];
          toc[m * 7 + ni] = fastTanh(-t / 2);
        }
      }
      for (let n = 0; n < LDPC_N; n++) {
        for (let mi = 0; mi < 3; mi++) {
          const m = MN[n][mi] - 1;
          let t = 1;
          for (let ni = 0; ni < NUM_ROWS[m]; ni++) if (NM[m][ni] - 1 !== n) t *= toc[m * 7 + ni];
          tov[n * 3 + mi] = -2 * fastAtanh(t);
        }
      }
    }
    return minErrors;
  }

  // ── WSJT-X call hashes (packjt77.f90 ihashcall) ───────────────────────────
  const HASH_CHARS = " 0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ/";
  function ihashcall(call, m) {
    const c = call.replace(/^</, "").replace(/>.*$/, "").padEnd(11, " ").slice(0, 11);
    let n8 = 0n;
    for (const ch of c) n8 = 38n * n8 + BigInt(HASH_CHARS.indexOf(ch));
    return Number(BigInt.asUintN(64, 47055833459n * n8) >> BigInt(64 - m));
  }
  /** Calls seen recently, so hashed calls (<...>) can be shown by name. */
  class CallHashes {
    constructor() { this.h22 = new Map(); this.h12 = new Map(); }
    save(call) {
      if (!call || call.length < 3 || call[0] === "<" || /^(CQ|DE|QRZ)\b/.test(call)) return;
      const base = call.replace(/\/[RP]$/, "");
      for (const c of new Set([call, base])) {
        this.h22.set(ihashcall(c, 22), c);
        this.h12.set(ihashcall(c, 12), c);
      }
      if (this.h22.size > 2000) { this.h22.clear(); this.h12.clear(); }
    }
    get22(n) { const c = this.h22.get(n); return c ? `<${c}>` : "<...>"; }
    get12(n) { const c = this.h12.get(n); return c ? `<${c}>` : "<...>"; }
  }

  // ── Message unpacking (unpack.c) ──────────────────────────────────────────
  function unpackCallsign(n28, ip, i3, hashes) {
    if (n28 < NTOKENS) {
      if (n28 <= 2) return ["DE", "QRZ", "CQ"][n28];
      if (n28 <= 1002) return "CQ " + intToDd(n28 - 3, 3, false);
      if (n28 <= 532443) {
        let n = n28 - 1003, a = "";
        for (let i = 3; i >= 0; i--) { a = charn(n % 27, 4) + a; n = Math.floor(n / 27); }
        return "CQ " + a.trimStart();
      }
      return null;
    }
    n28 -= NTOKENS;
    if (n28 < MAX22) return hashes ? hashes.get22(n28) : "<...>";
    let n = n28 - MAX22;
    const c = new Array(6);
    c[5] = charn(n % 27, 4); n = Math.floor(n / 27);
    c[4] = charn(n % 27, 4); n = Math.floor(n / 27);
    c[3] = charn(n % 27, 4); n = Math.floor(n / 27);
    c[2] = charn(n % 10, 3); n = Math.floor(n / 10);
    c[1] = charn(n % 36, 2); n = Math.floor(n / 36);
    c[0] = charn(n % 37, 1);
    let r = c.join("").trim();
    if (!r) return null;
    if (ip) { if (i3 === 1) r += "/R"; else if (i3 === 2) r += "/P"; }
    return r;
  }

  function unpackType1(a, i3, hashes) {
    const n28a = ((a[0] << 21) | (a[1] << 13) | (a[2] << 5) | (a[3] >> 3)) >>> 0;
    const n28b = (((a[3] & 0x07) << 26) | (a[4] << 18) | (a[5] << 10) | (a[6] << 2) | (a[7] >> 6)) >>> 0;
    const ir = (a[7] & 0x20) >> 5;
    const igrid4 = ((a[7] & 0x1f) << 10) | (a[8] << 2) | (a[9] >> 6);
    const to = unpackCallsign(n28a >>> 1, n28a & 1, i3, hashes);
    const de = unpackCallsign(n28b >>> 1, n28b & 1, i3, hashes);
    if (to === null || de === null) return null;
    let extra;
    if (igrid4 <= MAXGRID4) {
      let n = igrid4;
      const d3 = n % 10; n = Math.floor(n / 10);
      const d2 = n % 10; n = Math.floor(n / 10);
      const l1 = n % 18; n = Math.floor(n / 18);
      const l0 = n % 18;
      extra = (ir ? "R " : "") + String.fromCharCode(65 + l0, 65 + l1) + d2 + d3;
    } else {
      const irpt = igrid4 - MAXGRID4;
      extra = irpt === 1 ? "" : irpt === 2 ? "RRR" : irpt === 3 ? "RR73" : irpt === 4 ? "73"
        : (ir ? "R" : "") + intToDd(irpt - 35, 2, true);
    }
    if (hashes) { hashes.save(to); hashes.save(de); }
    return { to, de, extra };
  }

  /** The first 71 bits of a77 as a BigInt. */
  function bits71(a) {
    let v = 0n;
    for (let i = 0; i < 9; i++) v = (v << 8n) | BigInt(a[i]);
    return v >> 1n;
  }

  function unpackText(a) {
    let v = bits71(a), s = "";
    for (let i = 0; i < 13; i++) { s = charn(Number(v % 42n), 0) + s; v /= 42n; }
    return { to: "", de: "", extra: s.trim() };
  }

  function unpackTelemetry(a) {
    return { to: "", de: "", extra: bits71(a).toString(16).toUpperCase().padStart(18, "0") };
  }

  function unpackNonstandard(a, hashes) {
    const n12 = (a[0] << 4) | (a[1] >> 4);
    let n58 = BigInt(a[1] & 0x0f) << 54n;
    for (let i = 2; i <= 7; i++) n58 |= BigInt(a[i]) << BigInt(46 - 8 * (i - 2));
    n58 |= BigInt(a[8] >> 2);
    const iflip = (a[8] >> 1) & 1;
    const nrpt = ((a[8] & 1) << 1) | (a[9] >> 7);
    const icq = (a[9] >> 6) & 1;
    let c11 = "";
    for (let i = 0; i < 11; i++) { c11 = charn(Number(n58 % 38n), 5) + c11; n58 /= 38n; }
    c11 = c11.trim();
    const call3 = hashes ? hashes.get12(n12) : "<...>";
    if (hashes) hashes.save(c11);
    const call1 = iflip ? c11 : call3, call2 = iflip ? call3 : c11;
    if (icq) return { to: "CQ", de: call2, extra: "" };
    return { to: call1, de: call2, extra: ["", "RRR", "RR73", "73"][nrpt] };
  }

  /** 77-bit payload (10 bytes) -> {text, to, de, extra}, or null if unsupported. */
  function unpack77(a, hashes) {
    const i3 = (a[9] >> 3) & 0x07;
    let f = null;
    if (i3 === 0) {
      const n3 = ((a[8] << 2) & 0x04) | ((a[9] >> 6) & 0x03);
      if (n3 === 0) f = unpackText(a);
      else if (n3 === 5) f = unpackTelemetry(a);
    } else if (i3 === 1 || i3 === 2) f = unpackType1(a, i3, hashes);
    else if (i3 === 4) f = unpackNonstandard(a, hashes);
    if (!f) return null;
    f.text = [f.to, f.de, f.extra].filter(Boolean).join(" ");
    return f;
  }

  // ── Message packing and encoding (pack.c, encode.c; used by the tests) ───
  function pack28(call) {
    if (call.startsWith("DE ")) return 0;
    if (call.startsWith("QRZ ")) return 1;
    if (call.startsWith("CQ ")) return 2;
    const len = call.split(" ")[0].length;
    let c6 = "      ";
    if (call.startsWith("3DA0") && len <= 7) c6 = ("3D0" + call.slice(4, len)).padEnd(6);
    else if (call.startsWith("3X") && /[A-Za-z]/.test(call[2]) && len <= 7) c6 = ("Q" + call.slice(2, len)).padEnd(6);
    else if (/[0-9]/.test(call[2] || "") && len <= 6) c6 = call.slice(0, len).padEnd(6);
    else if (/[0-9]/.test(call[1] || "") && len <= 5) c6 = (" " + call.slice(0, len)).padEnd(6);
    const i = [A1.indexOf(c6[0]), A2.indexOf(c6[1]), A3.indexOf(c6[2]), A4.indexOf(c6[3]), A4.indexOf(c6[4]), A4.indexOf(c6[5])];
    if (i.some(x => x < 0)) return -1;
    return NTOKENS + MAX22 + ((((i[0] * 36 + i[1]) * 10 + i[2]) * 27 + i[3]) * 27 + i[4]) * 27 + i[5];
  }

  function packGrid(g) {
    if (g == null) return MAXGRID4 + 1;
    if (g === "RRR") return MAXGRID4 + 2;
    if (g === "RR73") return MAXGRID4 + 3;
    if (g === "73") return MAXGRID4 + 4;
    if (/^[A-R][A-R][0-9][0-9]$/.test(g)) {
      return (((g.charCodeAt(0) - 65) * 18 + (g.charCodeAt(1) - 65)) * 10 + (g.charCodeAt(2) - 48)) * 10 + (g.charCodeAt(3) - 48);
    }
    if (g[0] === "R") return (MAXGRID4 + 35 + ddToInt(g.slice(1), 3)) | 0x8000;
    return MAXGRID4 + 35 + ddToInt(g, 3);
  }

  function pack77Type1(msg) {
    const s1 = msg.indexOf(" ");
    if (s1 < 0) return null;
    let a = pack28(msg), b = pack28(msg.slice(s1 + 1));
    if (a < 0 || b < 0) return null;
    const s2 = msg.indexOf(" ", s1 + 1);
    const g = packGrid(s2 >= 0 ? msg.slice(s2 + 1) : null);
    a *= 2; b *= 2;
    const out = new Uint8Array(10);
    out[0] = (a >>> 21) & 0xff; out[1] = (a >>> 13) & 0xff; out[2] = (a >>> 5) & 0xff;
    out[3] = ((a << 3) & 0xff) | ((b >>> 26) & 0xff);
    out[4] = (b >>> 18) & 0xff; out[5] = (b >>> 10) & 0xff; out[6] = (b >>> 2) & 0xff;
    out[7] = ((b << 6) & 0xff) | ((g >> 10) & 0xff);
    out[8] = (g >> 2) & 0xff;
    out[9] = ((g << 6) & 0xff) | (1 << 3);
    return out;
  }

  function packText77(text) {
    text = text.trim();
    let v = 0n;
    for (let j = 0; j < 13; j++) {
      const q = j < text.length ? A0.indexOf(text[j]) : 0;
      v = v * 42n + BigInt(q > 0 ? q : 0);
    }
    v <<= 1n;
    const out = new Uint8Array(10);
    for (let i = 8; i >= 0; i--) { out[i] = Number(v & 0xffn); v >>= 8n; }
    out[8] &= 0xfe; out[9] = 0;
    return out;
  }

  /** Text -> 77-bit payload: standard message if it parses, else free text. */
  function pack77(msg) {
    msg = msg.toUpperCase().replace(/\s+/g, " ").trim();
    return pack77Type1(msg) || packText77(msg);
  }

  function parity8(x) { x ^= x >> 4; x ^= x >> 2; x ^= x >> 1; return x & 1; }

  function encode174(a91) {
    const cw = new Uint8Array(22);
    for (let j = 0; j < 12; j++) cw[j] = a91[j];
    let mask = 0x80 >> (LDPC_K % 8), idx = 11;
    for (let i = 0; i < LDPC_M; i++) {
      let nsum = 0;
      for (let j = 0; j < 12; j++) nsum ^= parity8(a91[j] & GEN[i][j]);
      if (nsum & 1) cw[idx] |= mask;
      mask >>= 1;
      if (!mask) { mask = 0x80; idx++; }
    }
    return cw;
  }

  /** 77-bit payload -> channel tone sequence (79 for FT8, 105 for FT4). */
  function encodeTones(payload, protocol) {
    const ft4 = protocol === "ft4";
    const p = Uint8Array.from(payload);
    if (ft4) for (let i = 0; i < 10; i++) p[i] ^= FT4_XOR[i];
    const cw = encode174(addCrc(p));
    let bit = 0;
    const next = () => { const b = (cw[bit >> 3] >> (7 - (bit & 7))) & 1; bit++; return b; };
    if (!ft4) {
      const t = new Uint8Array(79);
      for (let i = 0; i < 79; i++) {
        if (i < 7) t[i] = FT8_COSTAS[i];
        else if (i >= 36 && i < 43) t[i] = FT8_COSTAS[i - 36];
        else if (i >= 72) t[i] = FT8_COSTAS[i - 72];
        else t[i] = FT8_GRAY[(next() << 2) | (next() << 1) | next()];
      }
      return t;
    }
    const t = new Uint8Array(105);
    for (let i = 0; i < 105; i++) {
      if (i === 0 || i === 104) t[i] = 0;
      else if (i < 5) t[i] = FT4_COSTAS[0][i - 1];
      else if (i >= 34 && i < 38) t[i] = FT4_COSTAS[1][i - 34];
      else if (i >= 67 && i < 71) t[i] = FT4_COSTAS[2][i - 67];
      else if (i >= 100) t[i] = FT4_COSTAS[3][i - 100];
      else t[i] = FT4_GRAY[(next() << 1) | next()];
    }
    return t;
  }

  /** Tones of the codeword that a91 (payload + CRC, as received) encodes. */
  function tonesFromA91(a91, protocol) {
    const p = a91.slice(0, 10);
    if (protocol === "ft4") for (let i = 0; i < 10; i++) p[i] ^= FT4_XOR[i];
    return encodeTones(p, protocol);
  }

  // ── Mixed-radix FFT (the frame lengths are 3840 = 2^8*15 and 1152 = 2^7*9) ─
  function makeFft(n) {
    const factors = [];
    let r = n;
    for (const p of [4, 2, 3, 5]) while (r % p === 0) { factors.push(p); r /= p; }
    for (let p = 7; r > 1; p += 2) while (r % p === 0) { factors.push(p); r /= p; }
    const cosT = new Float64Array(n), sinT = new Float64Array(n);
    for (let i = 0; i < n; i++) { cosT[i] = Math.cos(-2 * Math.PI * i / n); sinT[i] = Math.sin(-2 * Math.PI * i / n); }
    const tr = new Float64Array(16), ti = new Float64Array(16);

    function rec(len, inRe, inIm, inOff, stride, outRe, outIm, outOff, fi) {
      if (len === 1) { outRe[outOff] = inRe[inOff]; outIm[outOff] = inIm[inOff]; return; }
      const p = factors[fi], m = len / p, tw = n / len;
      for (let j = 0; j < p; j++) rec(m, inRe, inIm, inOff + j * stride, stride * p, outRe, outIm, outOff + j * m, fi + 1);
      for (let k = 0; k < m; k++) {
        for (let j = 0; j < p; j++) {
          const o = outOff + j * m + k, w = (j * k * tw) % n;
          const xr = outRe[o], xi = outIm[o];
          tr[j] = xr * cosT[w] - xi * sinT[w];
          ti[j] = xr * sinT[w] + xi * cosT[w];
        }
        for (let q = 0; q < p; q++) {
          let sr = 0, si = 0;
          for (let j = 0; j < p; j++) {
            const w = ((j * q * m) * tw) % n;
            sr += tr[j] * cosT[w] - ti[j] * sinT[w];
            si += tr[j] * sinT[w] + ti[j] * cosT[w];
          }
          outRe[outOff + q * m + k] = sr; outIm[outOff + q * m + k] = si;
        }
      }
    }
    const zeros = new Float64Array(n), oRe = new Float64Array(n), oIm = new Float64Array(n);
    /** Real input -> {re, im} (views reused between calls). */
    return input => { rec(n, input, zeros, 0, 1, oRe, oIm, 0, 0); return { re: oRe, im: oIm }; };
  }

  // ── Monitor: audio -> uint8 dB waterfall (decode_ft8.c monitor_*) ─────────
  class Monitor {
    /**
     * @param {object} o protocol "ft8"|"ft4"; sampleRate (12000); maxFreq Hz
     *   (search bound; null = Nyquist like decode_ft8); timeOsr/freqOsr (2).
     */
    constructor(o = {}) {
      const P = PROTO[o.protocol || "ft8"];
      const rate = o.sampleRate || 12000, tOsr = o.timeOsr || 2, fOsr = o.freqOsr || 2;
      this.protocol = o.protocol || "ft8";
      this.P = P; this.rate = rate;
      this.block = Math.trunc(rate * P.period);
      this.sub = this.block / tOsr;
      this.nfft = this.block * fOsr;
      this.norm = 2 / this.nfft;
      this.window = new Float64Array(this.nfft);
      for (let i = 0; i < this.nfft; i++) { const x = Math.sin(Math.PI * i / this.nfft); this.window[i] = x * x; }
      this.frame = new Float64Array(this.nfft);
      this.td = new Float64Array(this.nfft);
      this.fft = makeFft(this.nfft);
      const allBins = Math.trunc(rate * P.period / 2);
      const numBins = o.maxFreq ? Math.min(allBins, Math.ceil(o.maxFreq * P.period)) : allBins;
      this.wf = {
        maxBlocks: Math.trunc(P.slot / P.period), numBlocks: 0, numBins,
        timeOsr: tOsr, freqOsr: fOsr, blockStride: tOsr * fOsr * numBins, protocol: this.protocol,
      };
      this.wf.mag = new Uint8Array(this.wf.maxBlocks * this.wf.blockStride);
    }

    /** Fill the analysis frame with audio from before the slot (optional). */
    prime(samples) {
      const n = Math.min(samples.length, this.nfft);
      this.frame.fill(0);
      for (let i = 0; i < n; i++) this.frame[this.nfft - n + i] = samples[samples.length - n + i];
    }

    get full() { return this.wf.numBlocks >= this.wf.maxBlocks; }

    /** One symbol's worth (this.block samples) of audio. */
    process(frame) {
      const wf = this.wf;
      if (wf.numBlocks >= wf.maxBlocks) return;
      let off = wf.numBlocks * wf.blockStride, pos = 0;
      const nfft = this.nfft, sub = this.sub, f = this.frame, td = this.td;
      for (let ts = 0; ts < wf.timeOsr; ts++) {
        f.copyWithin(0, sub);
        for (let i = nfft - sub; i < nfft; i++) f[i] = frame[pos++];
        for (let i = 0; i < nfft; i++) td[i] = this.norm * this.window[i] * f[i];
        const { re, im } = this.fft(td);
        for (let fs = 0; fs < wf.freqOsr; fs++) {
          for (let bin = 0; bin < wf.numBins; bin++) {
            const s = bin * wf.freqOsr + fs;
            const db = 10 * Math.log10(1e-12 + re[s] * re[s] + im[s] * im[s]);
            const v = Math.trunc(2 * db + 240);
            wf.mag[off++] = v < 0 ? 0 : v > 255 ? 255 : v;
          }
        }
      }
      wf.numBlocks++;
    }
  }

  // ── Sync search (decode.c ft8_find_sync) ──────────────────────────────────
  const index = (wf, c) => ((c.timeOffset * wf.timeOsr + c.timeSub) * wf.freqOsr + c.freqSub) * wf.numBins + c.freqOffset;

  function syncScore(wf, c) {
    const ft4 = wf.protocol === "ft4";
    const nSync = ft4 ? 4 : 3, lenSync = ft4 ? 4 : 7, offs = ft4 ? 33 : 36, top = ft4 ? 3 : 7;
    const base = index(wf, c), mag = wf.mag, st = wf.blockStride;
    let score = 0, n = 0;
    for (let m = 0; m < nSync; m++) {
      for (let k = 0; k < lenSync; k++) {
        const block = (ft4 ? 1 : 0) + offs * m + k;
        const abs = c.timeOffset + block;
        if (abs < 0) continue;
        if (abs >= wf.numBlocks) break;
        const p = base + block * st;
        const sm = ft4 ? FT4_COSTAS[m][k] : FT8_COSTAS[k];
        const v = mag[p + sm];
        if (sm > 0) { score += v - mag[p + sm - 1]; n++; }
        if (sm < top) { score += v - mag[p + sm + 1]; n++; }
        if (k > 0 && abs > 0) { score += v - mag[p + sm - st]; n++; }
        if (k + 1 < lenSync && abs + 1 < wf.numBlocks) { score += v - mag[p + sm + st]; n++; }
      }
    }
    return n > 0 ? Math.trunc(score / n) : 0;
  }

  function heapDown(h, size) {
    let cur = 0;
    for (;;) {
      let lg = cur;
      const l = 2 * cur + 1, r = l + 1;
      if (l < size && h[l].score < h[lg].score) lg = l;
      if (r < size && h[r].score < h[lg].score) lg = r;
      if (lg === cur) break;
      [h[lg], h[cur]] = [h[cur], h[lg]];
      cur = lg;
    }
  }
  function heapUp(h, size) {
    let cur = size - 1;
    while (cur > 0) {
      const par = (cur - 1) >> 1;
      if (h[cur].score >= h[par].score) break;
      [h[par], h[cur]] = [h[cur], h[par]];
      cur = par;
    }
  }

  /**
   * The numCand strongest sync candidates, best first.  Start times are
   * searched over blocks tRange[0]..tRange[1]-1 (ft8_lib: -12..23).
   */
  function findSync(wf, numCand, minScore, tRange = [-12, 24]) {
    const heap = [];
    const c = { score: 0, timeOffset: 0, freqOffset: 0, timeSub: 0, freqSub: 0 };
    for (c.timeSub = 0; c.timeSub < wf.timeOsr; c.timeSub++) {
      for (c.freqSub = 0; c.freqSub < wf.freqOsr; c.freqSub++) {
        for (c.timeOffset = tRange[0]; c.timeOffset < tRange[1]; c.timeOffset++) {
          for (c.freqOffset = 0; c.freqOffset + 7 < wf.numBins; c.freqOffset++) {
            c.score = syncScore(wf, c);
            if (c.score < minScore) continue;
            if (heap.length === numCand && c.score > heap[0].score) {
              heap[0] = heap[heap.length - 1];
              heap.length--;
              heapDown(heap, heap.length);
            }
            if (heap.length < numCand) { heap.push({ ...c }); heapUp(heap, heap.length); }
          }
        }
      }
    }
    for (let len = heap.length; len > 1; len--) {
      [heap[len - 1], heap[0]] = [heap[0], heap[len - 1]];
      heapDown(heap, len - 1);
    }
    return heap;
  }

  // ── Soft bits and decoding (decode.c ft8_decode) ──────────────────────────
  const max2 = (a, b) => (a >= b ? a : b);

  function extractLikelihood(wf, c, log174) {
    const base = index(wf, c), st = wf.blockStride, mag = wf.mag;
    if (wf.protocol === "ft4") {
      for (let k = 0; k < 87; k++) {
        const sym = k + (k < 29 ? 5 : k < 58 ? 9 : 13), bi = 2 * k, block = c.timeOffset + sym;
        if (block < 0 || block >= wf.numBlocks) { log174[bi] = log174[bi + 1] = 0; continue; }
        const p = base + sym * st, s = FT4_GRAY.map(g => mag[p + g]);
        log174[bi] = max2(s[2], s[3]) - max2(s[0], s[1]);
        log174[bi + 1] = max2(s[1], s[3]) - max2(s[0], s[2]);
      }
      return;
    }
    for (let k = 0; k < 58; k++) {
      const sym = k + (k < 29 ? 7 : 14), bi = 3 * k, block = c.timeOffset + sym;
      if (block < 0 || block >= wf.numBlocks) { log174[bi] = log174[bi + 1] = log174[bi + 2] = 0; continue; }
      const p = base + sym * st, s = FT8_GRAY.map(g => mag[p + g]);
      log174[bi] = max2(max2(s[4], s[5]), max2(s[6], s[7])) - max2(max2(s[0], s[1]), max2(s[2], s[3]));
      log174[bi + 1] = max2(max2(s[2], s[3]), max2(s[6], s[7])) - max2(max2(s[0], s[1]), max2(s[4], s[5]));
      log174[bi + 2] = max2(max2(s[1], s[3]), max2(s[5], s[7])) - max2(max2(s[0], s[2]), max2(s[4], s[6]));
    }
  }

  function normalizeLogl(log174) {
    let sum = 0, sum2 = 0;
    for (let i = 0; i < LDPC_N; i++) { sum += log174[i]; sum2 += log174[i] * log174[i]; }
    const inv = 1 / LDPC_N, variance = (sum2 - sum * sum * inv) * inv;
    const k = Math.sqrt(24 / variance);
    for (let i = 0; i < LDPC_N; i++) log174[i] *= k;
  }

  const log174 = new Float32Array(LDPC_N), plain174 = new Uint8Array(LDPC_N);
  /** Try one candidate; returns {a91, crc, msg} or null. */
  function decodeCandidate(wf, c, maxIters, hashes) {
    extractLikelihood(wf, c, log174);
    normalizeLogl(log174);
    if (bpDecode(log174, maxIters, plain174) > 0) return null;
    const a91 = new Uint8Array(12);
    for (let i = 0; i < LDPC_K; i++) if (plain174[i]) a91[i >> 3] |= 0x80 >> (i & 7);
    const crc = extractCrc(a91);
    const chk = a91.slice();
    chk[9] &= 0xf8; chk[10] = 0;
    if (computeCrc(chk, 96 - 14) !== crc) return null;
    const payload = a91.slice(0, 10);
    if (wf.protocol === "ft4") for (let i = 0; i < 10; i++) payload[i] ^= FT4_XOR[i];
    const msg = unpack77(payload, hashes);
    if (!msg) return null;
    return { a91, crc, msg };
  }

  // ── SNR (2500 Hz bandwidth, like WSJT-X) ──────────────────────────────────
  // Signal: mean power in the decoded tone's cell over the message.  Noise:
  // the 10th percentile of every cell within +-250 Hz over the slot, scaled
  // to the mean of exponentially distributed noise power.  Picking the
  // quiet cells across frequency finds the floor between signals on a busy
  // band, and following frequency tracks the receiver's passband shape.
  const SNR_CAL = { ft8: 3.8, ft4: 3.4 };   // from a synthetic sweep, 10 to -16 dB (tests/ft8.test.js checks +-2 dB)

  function noiseColumns(wf) {
    const nb = wf.numBins, fo = wf.freqOsr, cols = fo * nb, rows = wf.numBlocks * wf.timeOsr;
    const period = wf.protocol === "ft4" ? PROTO.ft4.period : PROTO.ft8.period;
    const half = Math.round(250 * period) * fo;            // window half-width in frequency cells
    const nf = nb * fo, col = f => (f % fo) * nb + Math.floor(f / fo);   // frequency cell -> column
    const hist = new Uint32Array(256), out = new Float64Array(cols);
    let count = 0;
    const add = (f, d) => { const c = col(f); for (let r = 0; r < rows; r++) hist[wf.mag[r * cols + c]] += d; count += d * rows; };
    for (let f = 0; f < Math.min(half, nf); f++) add(f, 1);
    for (let f = 0; f < nf; f++) {
      if (f + half < nf) add(f + half, 1);
      if (f - half - 1 >= 0) add(f - half - 1, -1);
      let acc = 0, v = 0;
      for (; v < 255; v++) { acc += hist[v]; if (acc >= count * 0.1) break; }
      // 10th percentile of exponential power = 0.1054 * mean.
      out[col(f)] = Math.pow(10, ((v - 240) / 2) / 10) / 0.10536;
    }
    return out;
  }

  function estimateSnr(wf, c, tones, noiseCols) {
    const base = index(wf, c), st = wf.blockStride, nTones = wf.protocol === "ft4" ? 4 : 8;
    let sum = 0, n = 0, noise = 0;
    for (let i = 0; i < tones.length; i++) {
      const block = c.timeOffset + i;
      if (block < 0 || block >= wf.numBlocks) continue;
      sum += Math.pow(10, ((wf.mag[base + i * st + tones[i]] - 240) / 2) / 10);
      n++;
    }
    for (let t = 0; t < nTones; t++) noise += noiseCols[c.freqSub * wf.numBins + c.freqOffset + t];
    noise /= nTones;
    if (!n || !noise) return -30;
    const ratio = sum / n / noise - 1;
    const binHz = 1 / (wf.protocol === "ft4" ? PROTO.ft4.period : PROTO.ft8.period) / wf.freqOsr;
    const snr = 10 * Math.log10(Math.max(ratio, 1e-4)) - 10 * Math.log10(2500 / binHz) + SNR_CAL[wf.protocol];
    return Math.max(-30, Math.min(49, Math.round(snr)));
  }

  /**
   * Decode a filled waterfall.  Returns messages sorted by frequency:
   * {text, to, de, extra, freq (Hz of tone 0), dt (s, vs the nominal 0.5 s), snr, score}.
   */
  function decodeWaterfall(wf, o = {}) {
    const P = PROTO[wf.protocol];
    const maxFreq = wf.numBins / P.period;
    const numCand = o.maxCandidates || Math.max(20, Math.round(maxFreq * 120 / 3000));
    const cands = findSync(wf, numCand, o.minScore ?? 10, o.timeRange);
    const seen = new Map(), out = [];
    let noiseCols = null;
    for (const c of cands) {
      if (c.score < (o.minScore ?? 10)) continue;
      const r = decodeCandidate(wf, c, o.ldpcIters || 20, o.hashes);
      if (!r) continue;
      const key = `${r.crc}|${r.msg.text}`;
      if (seen.has(key)) continue;
      seen.set(key, true);
      const timeSec = (c.timeOffset + c.timeSub / wf.timeOsr) * P.period;
      out.push({
        ...r.msg,
        freq: (c.freqOffset + c.freqSub / wf.freqOsr) / P.period,
        timeSec,
        dt: +(timeSec - T_NOMINAL - (DT_CAL[wf.protocol] || 0)).toFixed(2),
        snr: estimateSnr(wf, c, tonesFromA91(r.a91, wf.protocol), noiseCols ||= noiseColumns(wf)),
        score: c.score,
      });
    }
    return out.sort((a, b) => a.freq - b.freq);
  }
  const DT_CAL = { ft8: 0.16, ft4: 0.047 };  // timeSec of a signal keyed at 0.5 s is 0.5 + this

  /** Decode a whole slot of samples that starts at the slot boundary (like decode_ft8). */
  function decodeSamples(samples, o = {}) {
    const mon = new Monitor(o);
    for (let p = 0; p + mon.block <= samples.length && !mon.full; p += mon.block) mon.process(samples.subarray(p, p + mon.block));
    return decodeWaterfall(mon.wf, o);
  }

  // ── Live receiver: slices streamed audio into UTC slots ───────────────────
  /**
   * feed() it audio as it arrives; it maps samples to UTC from the arrival
   * times (the fastest-arriving chunk over the last few seconds sets the
   * offset, so network jitter only ever looks like extra latency), builds the
   * waterfall one symbol at a time and decodes each slot as it ends.
   *
   *   onDecode(messages, slotStartMs)   after every slot (messages may be [])
   *   onStatus({slotStartMs, msInto, slotMs, waiting, adjMs})
   *
   * Pass nowMs from a good clock (decode_ui.js uses the server's).  What is
   * left is the audio's own delay; once a slot gives a few decodes whose
   * median DT is off by more than 0.2 s, the slots are shifted by it (adjMs,
   * which can be carried over to the next receiver with o.adjMs).  FT4 needs
   * this: it only searches DT -0.6..+1.1 s.
   */
  class FtxReceiver {
    constructor(o) {
      this.protocol = o.protocol || "ft8";
      this.P = PROTO[this.protocol];
      this.rate = o.sampleRate || 12000;
      this.maxFreq = o.maxFreq || 3200;
      this.onDecode = o.onDecode || (() => {});
      this.onStatus = o.onStatus || (() => {});
      this.hashes = o.hashes || new CallHashes();
      this.slotMs = this.P.slot * 1000;
      // ft8_lib searches FT4 only to DT +0.56 s, less than the audio delay
      // of a stream; its 7.5 s slot leaves room to search to +1.7 s.
      this.timeRange = o.timeRange || (this.protocol === "ft4" ? [-12, 48] : [-12, 24]);
      this.reset();
      this.adjMs = o.adjMs || 0;
      this.adjusted = !!o.adjMs;
    }

    reset() {
      this.n = 0;                          // samples received
      this.first = 0;                      // absolute index of the first sample
      this.hist = new Float32Array(1 << 16);
      this.arrivals = [];                  // [ms, offset] of recent chunks
      this.t0 = null;                      // UTC ms of sample 0
      this.cur = null;
    }

    timeOf(k) { return this.t0 + k / this.rate * 1000; }
    sampleAt(ms) { return Math.round((ms - this.t0) / 1000 * this.rate); }

    /** Samples k..k+len-1 (zeros where we have none). */
    take(k, len) {
      const out = new Float32Array(len), cap = this.hist.length;
      for (let i = 0; i < len; i++) {
        const j = k + i;
        if (j >= this.first && j < this.n && j >= this.n - cap) out[i] = this.hist[j & (cap - 1)];
      }
      return out;
    }

    startSlot(slotStartMs) {
      const mon = new Monitor({ protocol: this.protocol, sampleRate: this.rate, maxFreq: this.maxFreq });
      const start = this.sampleAt(slotStartMs + this.adjMs);
      mon.prime(this.take(start - mon.nfft, mon.nfft));
      this.cur = { slotStartMs, start, mon };
    }

    feed(samples, nowMs = Date.now()) {
      const cap = this.hist.length;
      for (let i = 0; i < samples.length; i++) this.hist[(this.n + i) & (cap - 1)] = samples[i];
      this.n += samples.length;
      // Arrival-time -> sample clock: lowest (arrival - audio time) over ~8 s.
      const off = nowMs - this.n / this.rate * 1000;
      this.arrivals.push([nowMs, off]);
      while (this.arrivals.length && this.arrivals[0][0] < nowMs - 8000) this.arrivals.shift();
      this.t0 = Math.min(...this.arrivals.map(a => a[1]));

      if (!this.cur) {
        // Join the slot in progress if we have (nearly) all of it, else the next.
        const tFirst = this.timeOf(this.first);
        let s = Math.floor(tFirst / this.slotMs) * this.slotMs;
        if (tFirst - s > 1500) s += this.slotMs;
        this.startSlot(s);
      }
      for (;;) {
        const c = this.cur, mon = c.mon;
        const k = c.start + mon.wf.numBlocks * mon.block;
        if (k < this.n - cap + mon.block) {
          // Fell too far behind (tab was asleep): skip to the current slot.
          this.startSlot(Math.floor(this.timeOf(this.n) / this.slotMs) * this.slotMs);
          continue;
        }
        if (k + mon.block > this.n) break;
        mon.process(this.take(k, mon.block));
        if (mon.full) {
          let msgs = [];
          try { msgs = decodeWaterfall(mon.wf, { hashes: this.hashes, timeRange: this.timeRange }); } catch (e) { console.error("FT8 decode", e); }
          this.onDecode(msgs, c.slotStartMs);
          this.learnTiming(msgs);
          this.startSlot(c.slotStartMs + this.slotMs);
        }
      }
      const c = this.cur, msInto = this.timeOf(this.n) - c.slotStartMs;
      this.onStatus({ slotStartMs: c.slotStartMs, msInto, slotMs: this.slotMs, waiting: msInto < 0, adjMs: this.adjMs });
    }

    /** Shift the slot timing by the median DT of a slot with enough decodes. */
    learnTiming(msgs) {
      if (msgs.length < (this.protocol === "ft4" ? 2 : 3)) return;
      const dts = msgs.map(m => m.dt).sort((a, b) => a - b);
      const med = dts[dts.length >> 1];
      if (Math.abs(med) <= 0.2) return;
      this.adjMs += med * 1000 * (this.adjusted ? 0.5 : 1);
      this.adjusted = true;
    }
  }

  return {
    PROTO, Monitor, FtxReceiver, CallHashes,
    decodeSamples, decodeWaterfall, findSync,
    pack77, unpack77, encodeTones, computeCrc, addCrc, ihashcall,
    _cal: { SNR_CAL, DT_CAL },
  };
})();

if (typeof module !== "undefined" && module.exports) module.exports = FT8;
else window.FT8 = FT8;
