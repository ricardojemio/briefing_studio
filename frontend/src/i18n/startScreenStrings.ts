// src/i18n/startScreenStrings.ts
//
// All user-facing strings for the new start screen, in Portuguese (this
// screen ships in PT-BR from the start, per product decision). Kept in one
// place — same pattern as comparisonStrings.ts — so copy changes don't
// require hunting through StartScreen.tsx.

export const startScreenStrings = {
  header: {
    productName: 'ArtReview',
  },

  hero: {
    title:    'Compare duas versões de uma arte em PDF',
    subtitle: 'Envie a versão original e a revisada. O ArtReview aponta cada diferença de texto e visual, e você aceita ou rejeita uma a uma.',
  },

  upload: {
    labelOriginal:    '1 · ORIGINAL',
    labelRevised:     '2 · REVISADA',
    dragOriginal:     'Arraste o PDF da versão original aqui',
    dragRevised:      'Arraste o PDF da versão revisada aqui',
    chooseFile:       'Escolher arquivo',
    changeFile:       'Trocar arquivo',
    invalidFileType:  'Envie um arquivo em PDF.',
    includeCompliance: 'Incluir verificações de conformidade',
  },

  compare: {
    button:  'Comparar versões →',
    helper:  'Um projeto é criado automaticamente com o nome do arquivo original.',
    loading: 'Comparando…',
  },

  projects: {
    heading:         'Projetos',
    searchLabel:     'Buscar projeto',
    searchPlaceholder: 'Buscar projeto',
    empty:           'Nenhum projeto encontrado.',
    emptyNoSearch:   'Nenhum projeto ainda. Envie as duas versões acima para criar o primeiro.',
    lastComparison:  (date: string) => `Última comparação em ${date}`,
    pendingDiffs:    (n: number) => `${n} diferença${n !== 1 ? 's' : ''} pendente${n !== 1 ? 's' : ''}`,
  },

  errors: {
    createProcessFailed:    'Não foi possível criar o projeto. Nenhum dado foi salvo — tente novamente.',
    addOriginalFailed:      (projectName: string) =>
      `O projeto "${projectName}" foi criado, mas o envio da versão original falhou. O projeto ficou criado sem arquivo — abra-o e tente enviar a versão original de novo, ou tente criar uma nova comparação do início.`,
    runComparisonFailed:    (projectName: string) =>
      `O projeto "${projectName}" foi criado e a versão original foi salva, mas a comparação com a versão revisada falhou. Abra o projeto e envie a versão revisada novamente pela aba Comparação.`,
    genericFailed: 'Algo deu errado ao comparar as versões. Tente novamente.',
  },
} as const
