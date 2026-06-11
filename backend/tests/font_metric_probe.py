import sys; sys.path.insert(0,'/app')
import os; os.environ['DATABASE_URL']='postgresql://briefing:briefing123@db/briefing_db'
import fitz
from engines.pdf_draft_engine import _measure_text_width, _get_page_spans
from engines.draft_engine import _font
from core.config import settings

PDF  = '/app/uploads/3e1f89674b4045638f15b987275e5995_SKU_CODE_CLIENT_PRODUCT_DURA_4 pc_Carton.pdf'
DPI  = settings.PDF_DPI_HIGH
text = 'Tabletas'

doc = fitz.open(PDF)
page = doc[0]
spans = _get_page_spans(page)
doc.close()

span = next(s for s in spans if 'Tabletas' in s['text'])
orig_size_pt = float(span['size'])
span_w_pt    = span['bbox'][2] - span['bbox'][0]

print('='*65)
print('Span: "%s"  native_size=%.2fpt  span_w=%.2fpt' % (text, orig_size_pt, span_w_pt))
print('='*65)

def pil_width_pts(text, size_px, dpi):
    fnt = _font(size_px)
    px  = fnt.getlength(text)
    return px * 72.0 / dpi

def helv_width_pts(text, size_pt):
    return _measure_text_width(text, 'helv', size_pt)

for label, fs, note in [
    ('orig (7.6pt)', orig_size_pt, 'Replace collision'),
    ('resize 36pt',  36.0, 'Resize collision moderate'),
    ('resize 72pt',  72.0, 'Test 17 scenario'),
    ('resize 144pt', 144.0, 'Extreme resize'),
]:
    px      = max(6, int(fs * DPI / 72))
    fitz_w  = helv_width_pts(text, fs)
    pil_w   = pil_width_pts(text, px, DPI)
    delta   = fitz_w - pil_w
    pct     = abs(delta) / max(pil_w, 0.001) * 100
    print('\nScenario: %s  [%s]' % (label, note))
    print('  new_px (raster) = %d px' % px)
    print('  fitz helv       = %.2f pt  <- projected collision rect' % fitz_w)
    print('  PIL rendered    = %.2f pt  <- actual raster render' % pil_w)
    print('  delta           = %+.2f pt  (%.1f%% %s-estimate)' % (delta, pct, 'over' if delta>0 else 'under'))

print('\n-- PIL font size awareness --')
for px in [6, 30, 45, 100, 150, 300]:
    w = _font(px).getlength(text)
    print('  _font(%3d).getlength("%s") = %5.1f px = %5.2f pt @ DPI=%d' % (
        px, text, w, w*72/DPI, DPI))
print('\nConclusion on PIL size-awareness:')
widths = [_font(px).getlength(text) for px in [6,30,45,100,150,300]]
if len(set(widths)) == 1:
    print('  ALL SAME (%s px) -- _font() returns size-FIXED font at all sizes' % widths[0])
    print('  Root cause: no TTF files installed; falls back to load_default() (no size arg)')
    print('  Effect: raster engine renders ALL text at the SAME physical size')
else:
    print('  Different widths -- font size IS respected')
