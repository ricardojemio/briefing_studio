// src/i18n/comparisonStrings.ts
//
// All user-facing strings for the artwork comparison screen, in one place.
// Text stays in English for now (per product decision) — this file exists
// so a future translation pass has a single place to edit instead of
// hunting through ComparisonViewer.tsx and ProcessDetailPage.tsx.

export const comparisonStrings = {
  tabs: {
    comparison: 'Comparison',
    overview:   'Overview',
    timeline:   'Timeline',
  },

  summaryBar: {
    differences:      (n: number) => `${n} difference${n !== 1 ? 's' : ''}`,
    identical:        'Identical',
    reviewedProgress: (reviewed: number, total: number) => `${reviewed} of ${total} reviewed`,
  },

  pageLabels: {
    original: 'ORIGINAL',
    revised:  'REVISED',
    pageOf:   (current: number, total: number) => `Page ${current} of ${total}`,
    notAvailable: 'Page not available',
  },

  thumbnails: {
    heading: 'Pages',
  },

  diffCard: {
    typeText:          'Text changed',
    typeVisual:        'Visual',
    typeFontSize:      'Font size',
    typeFontStyle:     'Font style',
    typeColor:         'Colour',
    typeCode:          'EAN / Barcode',
    typeDimensional:   'Dimensional',
    typeCompliance:    'Compliance',
    page:              (n: number) => `Pg. ${n}`,
    statusPending:     'Pending',
    statusAccepted:    'Accepted',
    statusRejected:    'Rejected',
    accept:            'Accept',
    reject:            'Reject',
    noteLabel:         'Audit comment (optional)',
    notePlaceholder:   'Add a note…',
    confirm:           'Confirm',
    cancel:             'Cancel',
    saving:            'Saving…',
  },

  diffPanel: {
    heading:        'Differences',
    empty:          'No differences on this page',
    previous:       'Previous',
    next:           'Next',
    complete:       (reviewed: number, total: number) => `Complete review · ${reviewed} of ${total} reviewed`,
  },

  reviewBar: {
    heading:          'Review',
    pending:          (n: number) => `${n} pending`,
    accepted:         (n: number) => `${n} accepted`,
    rejected:         (n: number) => `${n} rejected`,
    reviewedOf:       (reviewed: number, total: number) => `(${reviewed}/${total} reviewed)`,
    emailPlaceholder: 'reviewer@company.com',
    emailTitle:       'Your email — required to record reviews',
    approve:          'Approve Comparison',
    approveWithRejections: 'Approve with Rejections',
    approving:        'Approving…',
    approvedAt:       (date: string) => `Approved ${date}`,
  },

  upload: {
    heading:     'Run Artwork Comparison',
    description: 'Upload the revised PDF from your design studio. The system will automatically detect text, code, visual, and dimensional differences.',
    chooseFile:  'Choose revised PDF',
    changeFile:  'Change file',
    compare:     'Compare Artworks',
    comparing:   'Analysing…',
    newComparison: 'New comparison',
  },

  toolbar: {
    fitWidth: 'Fit width',
    rotate:   'Rotate',
  },
} as const
