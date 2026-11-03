# eval/ — harness de avaliação quantitativa

- `pairs/` — 5 pares sintéticos gerados por `synth_generator.py` (bula pública Sonridor).
- `manual_pairs/` — 4 pares reais fornecidos pelo usuário (Sonridor/Mounjaro, bulas públicas
  ANVISA). Gabaritos ainda **PROVISÓRIOS**: reconstruídos por inspeção dos PDFs, não fornecidos
  pelo usuário — substituir quando os originais chegarem; em caso de divergência, os do usuário
  prevalecem.
- `harness.py` — roda `compare_artworks()` sobre um conjunto de pares e pontua contra o gabarito.
- `run_manual_pairs.py` — mesma lógica do harness, aplicada a `manual_pairs/` em vez de `pairs/`.
- `investigations/` — investigações pontuais arquivadas (causa raiz de bugs, provas de conceito).

## Métricas: exata vs. normalizada

O harness reporta quatro métricas: `lenient`, `lenient_normalized`, `strict` (="exata") e
`strict_normalized` (="normalizada").

A normalização foi introduzida depois de observar, na branch `fix/line-level-text-diff`, que o
comparador passou a reportar edições de texto na granularidade da palavra isolada (ex.: `"750"`
→ `"755"`) em vez da frase inteira em que a palavra está inserida (ex.: `"paracetamol 750 mg"`
→ `"paracetamol 755 mg"`). As duas descrições são corretas para o mesmo edit real — só diferem
em granularidade — mas a métrica `strict` original (comparação exata de texto + bbox por IoU)
não tinha como distinguir isso de um erro de conteúdo genuíno, e penalizava os dois casos da
mesma forma.

**O gabarito não foi alterado para acomodar a saída do comparador** — isso foi tentado numa
rodada anterior e revertido por instrução explícita. A granularidade do gabarito é a que o
usuário forneceu (ou, nos pares provisórios, a que foi reconstruída por inspeção numa
granularidade de frase/linha, consistente com como um revisor humano descreveria o edit). Em vez
disso, a normalização entra só na forma de medir:

- **texto**: reduz o par (antigo, novo) tanto do gabarito quanto do detectado ao seu edit mínimo
  — removendo o maior prefixo e sufixo comuns em nível de palavra — antes de comparar. Isso faz
  `("paracetamol 750 mg", "paracetamol 755 mg")` e `("750", "755")` normalizarem para o mesmo
  núcleo `("750", "755")`, sem deixar de rejeitar um erro de conteúdo real (ex. `"750"→"1"` não
  bate com `"750"→"755"` depois de normalizado).
- **bbox**: além do IoU ≥ 0,10 (critério leniente original), aceita um match quando a bbox
  detectada está majoritariamente contida na esperada (interseção / área da detectada ≥ 0,5) —
  cobre o caso em que o gabarito descreve uma frase inteira e o detector isola corretamente só a
  palavra que mudou dentro dela.

**As duas versões (exata e normalizada) são reportadas lado a lado por transparência** — a exata
mostra o que a comparação ingênua diria (e, no caso dos pares com edição pontual de
caractere/palavra, superestima a quantidade de "erro" do sistema por puro desalinhamento de
granularidade); a normalizada mostra o resultado depois de remover esse efeito. Nenhuma das duas
substitui a outra nos relatórios — ver commits na branch `fix/line-level-text-diff` para os
números completos, por par e agregados.

## Diffs visuais (`type == "visual"`) não são penalizados por texto nas métricas estritas

`compare_artworks()` nunca extrai texto para uma mudança do tipo `"visual"` — é um diff de
pixels, não de texto; `original_text`/`revised_text` saem sempre `""`. As métricas `strict` e
`strict_normalized` aplicam um critério de match de texto (`_text_matches`/
`_text_matches_minimal_edit` em `harness.py`) em cima do match de bbox+página já aceito pela
métrica lenient correspondente — mas, para um diff visual, esse critério não mede nada real: só
mediria se quem escreveu o gabarito por acaso descreveu a mudança (ex. `"(area em branco)"` →
`"caixa laranja 60x16 pt"`) usando as mesmas palavras que o sistema nunca produz.

Por isso `harness._is_textless_type(expected)` (`type in ("visual", "dimensional",
"compliance")`) faz `_text_matches`/`_text_matches_minimal_edit` retornarem `True`
incondicionalmente para esses tipos — **sob as métricas estritas, uma mudança visual exige só
região (IoU) + página, nunca texto antigo/novo**. Isso não afrouxa nenhum limiar do comparador
(IoU, threshold de pixel, etc.) nem altera o gabarito: só corrige o que a métrica estrita
*mede* para um tipo de diff que nunca teve texto para começar. `dimensional`/`compliance` entram
na mesma regra pelo mesmo motivo (tamanho de página e fonte mínima também não produzem texto).

`eval/run_altered_pairs.py` converte o campo `tipo: "ALTERACAO_VISUAL"` do gabarito acomodando a
mesma regra na origem: `_to_expected()` não coloca a descrição humana do gabarito em
`original_text`/`revised_text` para esses casos (fica só em `description`) — redundante com a
regra acima em `harness.py`, mas evita que o próprio relatório detalhado (que carrega texto real)
sugira uma comparação de texto que nunca acontece de fato.
