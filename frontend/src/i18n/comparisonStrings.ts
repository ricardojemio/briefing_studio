// src/i18n/comparisonStrings.ts
//
// All user-facing strings for the artwork comparison screen, in one place.
// Translated to Portuguese (product decision) — this file is still the
// single place to edit instead of hunting through ComparisonViewer.tsx and
// ProcessDetailPage.tsx.

export const comparisonStrings = {
  tabs: {
    comparison: 'Comparação',
    overview:   'Visão geral',
    timeline:   'Histórico',
  },

  summaryBar: {
    differences:      (n: number) => `${n} diferença${n !== 1 ? 's' : ''}`,
    identical:        'Idêntico',
    reviewedProgress: (reviewed: number, total: number) => `${reviewed} de ${total} revisadas`,
  },

  pageLabels: {
    original: 'ORIGINAL',
    revised:  'REVISADA',
    pageOf:   (current: number, total: number) => `Página ${current} de ${total}`,
    notAvailable: 'Página não disponível',
  },

  thumbnails: {
    heading: 'Páginas',
  },

  diffCard: {
    typeText:          'Texto alterado',
    typeVisual:        'Visual',
    typeFontSize:      'Tamanho da fonte',
    typeFontStyle:     'Estilo da fonte',
    typeColor:         'Cor',
    typeCode:          'EAN / Código de barras',
    typeDimensional:   'Dimensional',
    typeCompliance:    'Conformidade',
    page:              (n: number) => `Pág. ${n}`,
    statusPending:     'Pendente',
    statusAccepted:    'Aceita',
    statusRejected:    'Rejeitada',
    accept:            'Aceitar',
    reject:            'Rejeitar',
    noteLabel:         'Comentário de auditoria (opcional)',
    notePlaceholder:   'Adicionar observação…',
    confirm:           'Confirmar',
    cancel:             'Cancelar',
    saving:            'Salvando…',
  },

  diffPanel: {
    heading:        'Diferenças',
    empty:          'Nenhuma diferença nesta página',
    previous:       'Anterior',
    next:           'Próxima',
    complete:       (reviewed: number, total: number) => `Concluir revisão · ${reviewed} de ${total} revisadas`,
  },

  reviewBar: {
    heading:          'Revisão',
    pending:          (n: number) => `${n} pendente${n !== 1 ? 's' : ''}`,
    accepted:         (n: number) => `${n} aceita${n !== 1 ? 's' : ''}`,
    rejected:         (n: number) => `${n} rejeitada${n !== 1 ? 's' : ''}`,
    reviewedOf:       (reviewed: number, total: number) => `(${reviewed}/${total} revisadas)`,
    emailPlaceholder: 'revisor@empresa.com',
    emailTitle:       'Seu e-mail — necessário para registrar revisões',
    approve:          'Aprovar comparação',
    approveWithRejections: 'Aprovar com rejeições',
    approving:        'Aprovando…',
    approvedAt:       (date: string) => `Aprovado em ${date}`,
  },

  upload: {
    heading:     'Executar comparação de arte',
    description: 'Envie o PDF revisado do seu estúdio de design. O sistema detecta automaticamente diferenças de texto, código, visuais e dimensionais.',
    chooseFile:  'Escolher PDF revisado',
    changeFile:  'Trocar arquivo',
    compare:     'Comparar artes',
    comparing:   'Analisando…',
    newComparison: 'Nova comparação',
  },

  toolbar: {
    fitWidth:      'Ajustar à largura',
    rotate:        'Girar',
    fitWidthTitle: 'Ajustar à largura (Ctrl+0)',
    zoomMinTitle:  'Zoom mínimo (25%)',
    zoomInActiveTitle:   'Zoom de aumento ativo — clique de novo para desativar',
    zoomInTitle:         'Zoom de aumento — clique no PDF para ampliar (Ctrl+=)',
    zoomOutActiveTitle:  'Zoom de redução ativo — clique de novo para desativar',
    zoomOutTitle:        'Zoom de redução — clique no PDF para reduzir (Ctrl+−)',
    zoomMaxTitle:  'Zoom máximo (400%)',
    rotateTitle:   'Girar 90° no sentido horário',
  },

  loading: 'Carregando comparações…',

  hints: {
    enterEmailToReview: 'Informe seu e-mail de revisor antes',
    enterEmailAbove:    'Informe seu e-mail de revisor acima para começar a revisar',
  },

  errors: {
    comparisonFailed: 'A comparação falhou',
  },
} as const
