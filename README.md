# ArtReview (briefing_studio)

Ferramenta que compara automaticamente duas versões de uma arte farmacêutica (bula ou embalagem)
em PDF — uma versão **original** e uma **revisada** — e lista as diferenças encontradas entre
elas. A ideia é apoiar a revisão humana antes da aprovação final de uma peça gráfica regulada,
não substituí-la.

Este repositório é o código do Trabalho de Conclusão de Curso (TCC) de **Julio Ricardo Jemio
Sanchez** (UVA), orientado pelo **Prof. Vitor Amadeu Souza**.

## Escopo das diferenças detectadas

| Categoria | O que cobre | Como é detectado |
|---|---|---|
| **Texto** | Substituições, erros ortográficos, remoções e adições de texto | Extração nativa de texto (PyMuPDF) + diff por linha/palavra (`difflib`) |
| **Medidas e doses** | Mudanças de número associadas a dose, quantidade ou unidade (ex. "750 mg" → "570 mg") | Mesmo diff textual, classificado por regex (`MEASURE_RE`) |
| **Códigos** | EAN-8/EAN-13 e outros códigos numéricos de registro | Regex (`EAN_RE`) sobre o texto extraído |
| **Imagem** | Mudanças visuais (logos, cores, posição de elementos gráficos) | Registro geométrico (ORB + homografia RANSAC) seguido de diff de pixel (OpenCV) |

Fora de escopo: OCR (todo texto vem de extração nativa do PDF, nunca de reconhecimento de
imagem) e qualquer verificação de cor Pantone ou de arquivos vetoriais.

## Requisitos

- Docker e Docker Compose (v2). Nada mais precisa estar instalado localmente — tudo roda dentro
  dos containers.

## Como subir o ambiente

```bash
docker compose up --build
```

- Frontend: http://localhost:5173
- Backend API: http://localhost:8000
- Documentação interativa da API: http://localhost:8000/docs
- PostgreSQL: localhost:5432 (usuário/senha/banco em `docker-compose.yml`, só para
  desenvolvimento local — troque antes de expor o serviço em qualquer ambiente real)

Não há `.env` a copiar — as variáveis de ambiente do backend já vêm definidas no
`docker-compose.yml` para desenvolvimento local.

## Como rodar os testes

Com o ambiente no ar (`docker compose up`), em outro terminal:

```bash
docker compose exec backend pip install pytest pytest-asyncio httpx
docker compose exec backend python -m pytest -q --ignore=tests/test_coll.py
```

`tests/test_coll.py` é ignorado porque depende de um PDF de teste que só existe localmente no
ambiente de desenvolvimento original, fora deste repositório — sem ele, a simples coleção do
arquivo falha antes de qualquer teste rodar.

Há **1 falha conhecida**: `tests/test_resize_fix.py::TestResizeFix::test_dpi_150_vs_300_scaling`.
É uma inconsistência de arredondamento ao escalar tamanho de fonte entre 150 e 300 DPI — não
afeta a comparação de artes (o fluxo principal deste TCC), só um recurso secundário de edição de
rascunho (`pdf_draft_engine.py`).

## Como rodar a avaliação e reproduzir as tabelas do artigo

O harness (`backend/eval/`) mede precisão/revocação/F1 do comparador contra um gabarito (ground
truth), em quatro variantes: `lenient`, `lenient_normalized`, `strict` e `strict_normalized` (a
definição exata de cada uma está em `backend/eval/README.md`).

Os pares públicos já estão neste repositório — não precisa baixar nada para estes três comandos:

```bash
# Pares sintéticos (gerados a partir de uma bula pública)
docker compose exec backend python -m eval.harness
docker compose exec backend python -m eval.export_report

# Pares manuais reais (bulas públicas ANVISA — Sonridor e Mounjaro)
docker compose exec backend python -m eval.run_manual_pairs
docker compose exec backend python -m eval.export_report --manual
```

As tabelas saem em `backend/eval/exports/` (CSV e JSON) — são os números por trás das tabelas do
artigo: contagens de TP/FP/FN e P/R/F1, nunca texto extraído das artes.

### Pares alterados ("item D" do artigo)

Estes exigem bulas que **não estão neste repositório** (ver aviso abaixo):

```bash
docker compose exec backend python -m eval.run_altered_pairs \
    --gabarito eval/fixtures_alterados/gabarito_alteracoes.json \
    --pairs-dir eval/fixtures_alterados
docker compose exec backend python -m eval.export_report --altered \
    --gabarito eval/fixtures_alterados/gabarito_alteracoes.json \
    --pairs-dir eval/fixtures_alterados
```

Para reproduzir: crie a pasta `backend/eval/fixtures_alterados/` (ela é ignorada pelo git) com um
PDF original e uma versão alterada por produto, mais um `gabarito_alteracoes.json` descrevendo as
mudanças esperadas. Os produtos usados no artigo têm bula pública no **Bulário Eletrônico da
ANVISA** (https://consultas.anvisa.gov.br/#/bulario/) — busque pelo nome do produto/empresa:
Domperidona (Ranbaxy), Buscopan Composto (Boehringer Ingelheim), Albendazol 400 mg (Geolab), Sal
de Fruta ENO (GlaxoSmithKline). Baixe a bula, duplique como versão "alterada", edite manualmente
o campo que quer testar (ex. uma dose) e registre a mudança no `gabarito_alteracoes.json`, no
mesmo formato das entradas de exemplo. O schema completo está em
`backend/eval/run_altered_pairs.py`.

## Aviso: artes proprietárias não estão incluídas

Nenhuma arte, embalagem ou bula de cliente comercial/proprietária usada durante o desenvolvimento
ou a avaliação está neste repositório. Os únicos materiais de arte versionados são:

- Bulas públicas registradas na ANVISA (Bulário Eletrônico), usadas como fixtures de teste.
- Pares sintéticos gerados programaticamente a partir dessas bulas públicas.

Qualquer diretório de upload, preview ou cache (`backend/uploads/`, `backend/previews/`,
`backend/cache/`) é gerado em tempo de execução e está no `.gitignore` — nunca deve ser
versionado, mesmo que contenha arte de teste.

## Limitações conhecidas

- Sem OCR: um PDF escaneado sem camada de texto não é lido corretamente.
- A métrica `strict` ("exata") penaliza diferenças de granularidade entre o gabarito e o que o
  comparador reporta mesmo quando os dois descrevem a mesma edição real — é por isso que o
  harness também reporta `strict_normalized` ao lado; veja `backend/eval/README.md`.
- As regex que classificam "Medida/dose" (`MEASURE_RE`) e "Código" (`EAN_RE`) são propositalmente
  estreitas e podem não reconhecer frases fora do padrão esperado — ver
  `backend/eval/investigations/` para os casos encontrados e o raciocínio por trás de cada regra.
- Uma mudança visual muito perto de texto de segurança repetido (ex. um rodapé com uma frase
  impressa várias vezes) pode ser absorvida pela supressão de ruído — ver
  `backend/eval/investigations/visual_suppression_repetitive_pattern/`.
- Não há lockfile do frontend versionado — as versões de React/TypeScript/Vite em
  `frontend/package.json` são faixas (`^`), não um build travado.

## Versões

| Componente | Versão |
|---|---|
| Python | 3.11 |
| FastAPI | 0.104.1 |
| PostgreSQL | 15 |
| PyMuPDF | 1.23.8 |
| OpenCV | `opencv-python-headless>=4.8` |
| React | ^18.3 |
| TypeScript | ^5.4 |
| Vite | ^5.2 |

## Licença

Sugerida: **MIT** para o código deste repositório. Nenhuma arte, bula ou dado de cliente está
coberto por essa licença.
