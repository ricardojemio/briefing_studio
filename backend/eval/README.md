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
