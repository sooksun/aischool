// FR-002: scanned pages become one PDF, one page per scan, sized to the image.
import 'dart:typed_data';

import 'package:flutter_test/flutter_test.dart';
import 'package:image/image.dart' as img;
import 'package:seip_mobile/src/capture.dart';

Uint8List _jpeg(int w, int h) => Uint8List.fromList(img.encodeJpg(img.Image(width: w, height: h)));

void main() {
  test('three scanned pages make one PDF with three pages', () async {
    final pdf = await pagesToPdf([_jpeg(600, 800), _jpeg(600, 800), _jpeg(800, 600)], compress: false); // readable structure for the test
    final text = String.fromCharCodes(pdf);
    expect(text.startsWith('%PDF-'), isTrue);
    expect(RegExp(r'/Type\s*/Page[^s]').allMatches(text).length, 3);
    expect(RegExp(r'/MediaBox\s*\[0 0 800 600\]').hasMatch(text), isTrue, reason: 'a landscape page keeps its shape');
  });

  test('no pages is an error, not an empty PDF', () {
    expect(() => pagesToPdf([]), throwsArgumentError);
  });
}
