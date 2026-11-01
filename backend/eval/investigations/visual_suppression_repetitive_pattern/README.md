# CLIENT_PRODUCT_2 Foil: 5 mudanças visuais esperadas, só 2 blobs grandes relatados

## Parâmetros do diff de pixels (antes de qualquer mudança)
```
VISUAL_THRESHOLD     = 30    # diferença de intensidade de pixel (0–255)
VISUAL_MIN_AREA_PX2  = 100   # área mínima de contorno (px²) para reportar
VISUAL_DILATE_PX     = 5     # kernel de dilatação, 2 iterações
DPI usado no teste    = 150  (scale = dpi/72 ≈ 2.083 px/pt)
```
Pipeline: `cv2.absdiff` → cinza → `cv2.threshold(30)` → `cv2.dilate(5×5, iter=2)`
→ `cv2.findContours(RETR_EXTERNAL)` → filtra por área → supressão contra
diffs de texto/código e `edited_line_bboxes` (pad 4.0pt).

## Gabarito real (gabarito_alteracoes.json, chave `CLIENT_PRODUCT_2Foil`)
5 `ALTERACAO_VISUAL` no total: "barra alargada" e "logo CLIENT_BRAND removido"
em cada uma das 2 páginas (4), mais uma "caixa laranja 60×16pt" só na
página 1 (1) = 5.

## Diagnóstico — DUAS causas distintas, não uma

### Causa 1 (meu palpite inicial, DESCARTADO pela medição): dilatação funde regiões próximas
Medi conectividade ANTES e DEPOIS da dilatação (`cv2.connectedComponentsWithStats`):
```
ANTES  dilatação: maior componente = 415.916 px² (já um blob gigante)
DEPOIS dilatação: maior componente = 426.543 px² (cresce só ~2.5%)
```
A dilatação não é a causa — o blob gigante já existe no limiar bruto,
antes de qualquer dilatação. Descartado.

### Causa 2 (confirmada): supressão por linha editada engole mudanças visuais reais
Listei TODOS os contornos pós-dilatação com bbox em pt e comparei com o
gabarito — achei "barra alargada" e "logo removido" EXATAMENTE onde o
gabarito diz, como contornos bem localizados e corretos:
```
contorno bbox_pt=(404.2,352.3,411.4,376.8)  ~=  gabarito (403.2,354.7,409.2,374.5) "barra alargada"
contorno bbox_pt=(324.5,539.5,331.7,563.5)  ~=  gabarito (326.6,541.7,329.7,561.6) "logo removido"
```
O detector de pixels ACERTA os dois. Eles não chegam ao resultado final
porque são descartados pela supressão "já coberto por uma linha
editada" (`edited_line_bboxes`, pad 4.0pt).

**Por quê**: o foil tem texto de segurança/registro impresso repetido
muitas vezes ao longo de toda a largura da folha (ex.: `['CLIENT_BRAND',
'CLIENT_BRAND','CLIENT_BRAND','CLIENT_BRAND','CLIENT_BRAND','CLIENT_BRAND','PHARMA']`,
`['licenciadas','Dungarvan','PARACETAMOL']×6`). `_group_words_into_lines`
agrupa por proximidade de y — corretamente, é visualmente uma linha só —
mas o resultado é uma "linha" de 400 a 597pt de largura (quase a
largura inteira da página). Como o código usa a linha INTEIRA como
margem de segurança contra ruído de antialiasing de uma edição de
texto, essa margem gigante engole "barra alargada" (1.3pt abaixo do fim
dessa linha) e "logo removido" (sobreposição direta de bbox com outra
dessas linhas-padrão).

Confirmei que isso NÃO é bug de agrupamento: toda linha anômala listada
é literalmente uma frase curta repetida 5+ vezes — comportamento real
do foil, não erro do `_group_words_into_lines`.

### O blob gigante (0,1174 → 1141,1261pt) em si — achado separado, não corrigido
Comparei os pixels da região diretamente:
```
região original: BGR médio ≈ (248,248,248)  — quase branco/vazio
região revisada : BGR médio ≈ ( 12, 12, 12)  — quase preto sólido
diferença: 95.6% dos pixels da região (toda a largura da página) mudam >30
```
Isso é uma faixa preta sólida cobrindo quase toda a largura da página na
versão alterada, onde a original tem fundo branco — não são "5 mudanças
pequenas fundidas", é uma diferença real e enorme entre as duas
renderizações nessa faixa, maior até que a "caixa laranja 60×16pt"
esperada (e nem é da cor esperada — preto, não laranja). Qualquer
limiar/dilatação razoável reportaria isso como uma região grande,
porque ela REALMENTE é grande. Não é algo que ajuste de parâmetro do
comparador resolva — ou é um artefato de renderização do PDF alterado
(ex. recurso de imagem ausente/corrompido fazendo o PyMuPDF renderizar
um retângulo preto de preenchimento) ou um elemento real do arquivo de
teste que não corresponde ao que o gabarito descreve. Reportando como
achado separado, não tentei "corrigir" isso.

## Correção aplicada (só a causa 2)

`_is_repetitive_line(words)`: detecta se uma "linha" é um ciclo de 1 a 4
palavras repetido ≥3 vezes cobrindo ≥60% das palavras da linha
(`REPETITIVE_LINE_MIN_REPEATS=3`, `REPETITIVE_LINE_MIN_COVERAGE=0.6`).
Testado contra TODAS as ~40 linhas anômalas reais do CLIENT_PRODUCT_2 (todas
detectadas) e contra linhas de prosa normais dos outros pares — incluindo
frases de até 425pt de largura (bulas reais têm parágrafos genuinamente
largos) — zero falso positivo.

Quando uma linha editada é repetitiva: a margem de supressão passa a
ser um pad pequeno (`EDIT_PERTURBATION_PAD_PT=20pt`) em volta de cada
palavra editada, não a linha inteira. Quando não é repetitiva: continua
usando a linha inteira, exatamente como antes.

### Por que não dava para usar largura da linha como critério
Tentei isso primeiro. Bulas reais têm parágrafos de até 425.3pt de
largura (largura de página inteira) — tão largos quanto as linhas
anômalas do CLIENT_PRODUCT_2 (420–597pt). Não há limiar de largura que separe os
dois sem também desproteger parágrafos normais.

### Regressão real encontrada e corrigida (não escondida)
Minha primeira tentativa (pad fixo de 20pt em volta da palavra, SEMPRE,
em vez de condicionar a `_is_repetitive_line`) quebrou
`pair4_text_add_remove` do harness sintético: um blip visual de
antialiasing a 58.3pt da palavra editada "750"→"500", antes suprimido
pela linha inteira ("Comprimidos de 750 mg: embalagens com 20 e 50
comp..."), passou a aparecer como falso positivo visual. Essa linha é
normal (prosa, não repetitiva) — o pad de 20pt nunca deveria ter
substituído a linha inteira para ela. Corrigido tornando a troca
condicional a `_is_repetitive_line`.

## Resultado final

| | antes | depois |
|---|---|---|
| CLIENT_PRODUCT_2 Foil, visuais por página | 1 (só o blob gigante) | 3 (blob gigante + barra alargada + logo removido) |
| Domperidona / Buscopan / Albendazol | 5 / 7→6(item A) / 5→6(item A) | **sem mudança** (5/6/6) |
| `run_manual_pairs` | F1 normalizado 1.00 | **sem mudança** (1.00) |
| `harness` sintético (5 pares, incl. pair4) | F1 normalizado 1.00 | **sem mudança** (1.00) |
| pytest | 86 passando + 1 conhecida | 90 passando + 1 conhecida (4 testes novos) |

Testes novos em `backend/tests/test_visual_suppression_repetitive_line.py`.

## O que não foi resolvido (relatado, não escondido)
A "caixa laranja" esperada continua saindo como uma região muito maior
que 60×16pt (o blob gigante, causa separada acima) — das 5 mudanças
visuais do gabarito, 2 agora aparecem corretas e isoladas (barra
alargada, logo removido), 1 está presente mas com bbox muito maior que
o esperado (caixa laranja, dentro do blob), e as outras 2 entradas
"ALTERACAO_VISUAL" do gabarito são a MESMA barra/logo repetidos na
página 2 — já cobertas. O item D (pares alterados vs. gabarito) traz a
contagem oficial de TP/FP/FN.
