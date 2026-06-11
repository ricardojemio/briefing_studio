import sys; sys.path.insert(0,'/app')
import os; os.environ['DATABASE_URL']='postgresql://briefing:briefing123@db/briefing_db'
import fitz
from engines.pdf_draft_engine import _measure_text_width, _get_page_spans
from PIL import ImageFont
from core.config import settings

PDF  = '/app/uploads/3e1f89674b4045638f15b987275e5995_SKU_CODE_CLIENT_PRODUCT_DURA_4 pc_Carton.pdf'
DPI  = settings.PDF_DPI_HIGH
text = 'Tabletas'

doc = fitz.open(PDF)
span = next(s for s in _get_page_spans(doc[0]) if 'Tabletas' in s['text'])
doc.close()
orig_size_pt = float(span['size'])
span_w_pt    = span['bbox'][2] - span['bbox'][0]
span_h_pt    = span['bbox'][3] - span['bbox'][1]

print('=== Simulated PRODUCTION metrics (Aileron w/ explicit size) ===')
print('Using load_default(size=px) as proxy for a properly installed TTF font')
print()

for label, fs_pt in [('orig %.1fpt' % orig_size_pt, orig_size_pt), ('36pt', 36.0), ('72pt', 72.0)]:
    px           = max(6, int(fs_pt * DPI / 72))
    helv_w       = _measure_text_width(text, 'helv', fs_pt)
    pil_sized    = ImageFont.load_default(size=px).getlength(text) * 72.0 / DPI
    pil_nosize   = ImageFont.load_default().getlength(text) * 72.0 / DPI
    d_prod       = helv_w - pil_sized
    d_prod_pct   = abs(d_prod) / max(pil_sized, 0.001) * 100
    d_bug        = helv_w - pil_nosize
    d_bug_pct    = abs(d_bug) / max(pil_nosize, 0.001) * 100
    print('Font size: %s  (new_px=%d)' % (label, px))
    print('  fitz helv projected:          %7.2f pt' % helv_w)
    print('  PIL sized render (prod sim):  %7.2f pt  delta=%+.2fpt (%d%%)' % (pil_sized, d_prod, int(d_prod_pct)))
    print('  PIL no-size render (broken):  %7.2f pt  delta=%+.2fpt (%d%%)' % (pil_nosize, d_bug, int(d_bug_pct)))
    print()

print('Actual span width in PDF: %.2f pt (ground truth)' % span_w_pt)
print('Actual span height in PDF: %.2f pt' % span_h_pt)
print()
print('=== Height comparison ===')
for label, fs_pt in [('orig %.1fpt' % orig_size_pt, orig_size_pt), ('72pt', 72.0)]:
    proj_h = fs_pt * 1.2
    print('%s: proj_h=%.1fpt  span_h=%.1fpt' % (label, proj_h, span_h_pt))
