"""Extract local PDF text without transmitting document contents."""
import json, sys
import pymupdf

def main():
    if len(sys.argv) != 2:
        raise ValueError('Usage: extract_pdf.py input.pdf')
    with pymupdf.open(sys.argv[1]) as doc:
        pages = [p.get_text(sort=True).strip() for p in doc]
    if not any(pages):
        raise ValueError('PDF has no text layer; run OCR locally or supply an outline')
    print(json.dumps({'pages': pages}, ensure_ascii=True))

if __name__ == '__main__':
    try:
        main()
    except Exception as exc:
        print(json.dumps({'error': str(exc)}), file=sys.stderr)
        sys.exit(1)
