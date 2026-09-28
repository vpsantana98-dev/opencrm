# Gabarito — como julgar a resposta da IA local

Use este documento para avaliar o que a IA local respondeu ao briefing
(`docs/auditoria-briefing-ia-local.md`). Ele diz **o que uma boa resposta contém** e
**quais sinais indicam que ela auditaria errado**.

Não espere que ela acerte tudo. O que importa é: **ela chegaria sozinha no risco certo,
ou perderia tempo no lugar errado?**

---

# 1. O teste decisivo (se falhar aqui, reprovou)

> **A resposta menciona que as 32 rotas com `service role` IGNORAM o Row Level Security,
> e trata isso como a prioridade número um?**

Esse é o ponto que separa quem entendeu o sistema de quem recitou checklist.

**Por que é decisivo:** o RLS do banco é a rede de proteção que impede um cliente de ver
os dados de outro. Mas o `service role` **passa por cima do RLS**. Ou seja: naquelas 32
rotas, a única coisa que impede o vazamento entre clientes é o programador ter lembrado de
filtrar por conta **no código**. É exatamente ali que mora o risco real do produto.

- ✅ **Aprovado:** identifica isso, e coloca a revisão dessas 32 rotas como primeiro passo.
- ❌ **Reprovado:** diz algo como *"o RLS está ligado, então o isolamento está garantido"*.
  Isso é falso aqui, e é o erro mais perigoso que ela poderia cometer.

---

# 2. O que uma boa resposta contém

### 2.1 Ordem de investigação (item 1 do briefing)

Uma boa ordem, em essência:

1. **Isolamento entre contas nas rotas com service role** — maior impacto, e o RLS não
   protege.
2. **IDOR**: ids (`conversationId`, `contactId`, `accountId`…) que chegam pelo corpo/query
   da requisição e são usados sem checar se pertencem à conta do chamador.
3. **A armadilha do `profiles`**: o briefing diz que o usuário edita o próprio perfil e que
   `account_id`/`active_account_id` são *preferência, não autorização*. Uma boa resposta
   **percebe a contradição em potencial** e pergunta: *alguma rota usa `profiles.account_id`
   como se fosse autorização?*
4. **Endpoints sem autenticação** (portal do QR, webhooks, crons, redirecionador).
5. **Autorização por papel** (`viewer` conseguindo fazer coisa de `admin`).
6. **Segredos** — vazando em resposta de API ou no bundle do front.
7. **Front-end**: botão escondido por papel sem o bloqueio correspondente na API.
8. Resto (XSS, CSP, dependências, headers).

**Sinal de qualidade:** ela justifica a ordem por **impacto**, não por facilidade.

**Bônus (muito bom se aparecer):** notar que a autorização baseada numa coluna que o
próprio usuário escreve é escalonamento de privilégio — e que isso vale também para flags
de papel dentro de `profiles`.

### 2.2 Plano por área (item 2)

Boa resposta é **concreta**. Comparação:

| Ruim (genérico) | Bom (acionável) |
|---|---|
| "Verificar autenticação nas rotas" | "Para cada arquivo de `grep -rln supabaseAdmin src/app/api`, confirmar que chama `getCurrentAccount()` antes da primeira query e que todo `.eq('account_id', …)` usa o id da sessão, nunca o do corpo" |
| "Checar RLS" | "Comparar a lista de `CREATE TABLE` com a de `ENABLE ROW LEVEL SECURITY` nas migrations e apontar a diferença" |
| "Procurar XSS" | "Buscar `dangerouslySetInnerHTML`/`innerHTML` e, em cada um, verificar se o conteúdo vem de dado de usuário" |

### 2.3 As 5 perguntas mais perigosas (item 3)

As respostas de maior valor giram em torno de:

1. Uma rota com service role aceita `account_id` do cliente sem validar posse?
2. Alguma rota autoriza com base em coluna que o próprio usuário edita (`profiles`)?
3. Dá para acessar objeto de outra conta trocando um id na chamada de API? (IDOR)
4. Algum segredo (token de WhatsApp/Ads/ClickUp) volta ao navegador numa resposta de API
   ou está no bundle?
5. Os endpoints públicos permitem enumerar token, ou amplificar carga sem limite?

**Exigência:** cada uma tem que vir com **caminho de exploração** — quem é o atacante, que
acesso ele tem, o que faz, o que ganha. Sem isso, é lista de tema, não análise.

### 2.4 Limites e falso positivo (itens 4 e 5)

Uma boa resposta admite que **só lendo código** não dá para confirmar:
- se as migrations foram de fato aplicadas no banco de produção;
- se as variáveis de ambiente estão definidas no servidor;
- comportamento em runtime (rate limit real, headers que o proxy pode remover);
- configuração de infraestrutura.

E, sobre falso positivo, deveria propor algo como: rastrear o caminho completo do dado até
o ponto de saída antes de reportar; procurar a validação em camada anterior (middleware,
helper, policy) antes de concluir que não existe.

---

# 3. Sinais de alerta (ela auditaria errado)

| 🚩 Sinal | Por que é problema |
|---|---|
| **Não menciona o bypass de RLS pelo service role** | Perdeu o risco central. Ver seção 1. |
| **Diz "o RLS está ligado, então está seguro"** | Conclusão falsa e perigosa. |
| **Afirma ter rodado comando / apresenta resultado** | Alucinação — o briefing proíbe explicitamente. Não dá para confiar no resto. |
| **Inventa nome de arquivo, função ou tabela** que não estava no briefing | Mesma coisa. Confira: só existiam os nomes que você deu. |
| **Começa por `npm audit` / dependências** | Prioridade errada: é o item de menor impacto aqui. |
| **Devolve OWASP Top 10 genérico** sem adaptar ao multi-tenant | Não entendeu o produto; qualquer app receberia a mesma resposta. |
| **Foca em SQL injection** | O app usa query builder e RPC com bind. É o risco errado para esta stack. |
| **Ignora o front-end** ou trata como só XSS | Faltou "autorização que só existe no cliente", que é o risco real de front aqui. |
| **Não pede nada / não aponta limite** | Confiança sem base. Uma boa auditoria sabe o que não consegue ver. |
| **Trata `profiles` como fonte de autorização confiável** | É exatamente a armadilha plantada no briefing. |

---

# 4. Placar rápido

Marque o que apareceu:

| # | Critério | Peso |
|---|---|---|
| 1 | Identificou o bypass de RLS pelo service role como prioridade 1 | **Eliminatório** |
| 2 | Percebeu a armadilha do `profiles` (autorização em coluna auto-editável) | Alto |
| 3 | Citou IDOR (id do corpo usado sem checar posse) | Alto |
| 4 | Plano concreto, com comando/arquivo, não genérico | Alto |
| 5 | Caminho de exploração descrito nas 5 perguntas | Médio |
| 6 | Admitiu limites do que dá para ver só no código | Médio |
| 7 | Não alucinou (nenhum arquivo/resultado inventado) | **Eliminatório** |
| 8 | Cobriu front-end além de XSS | Médio |

**Leitura do placar:**
- Falhou 1 **ou** 7 → **não use essa IA para a auditoria.** Ela erraria o alvo ou inventaria
  achado, e auditoria com achado inventado é pior que auditoria nenhuma.
- Passou 1 e 7, mas falhou 2 e 3 → serve só para tarefas mecânicas (listar arquivos, achar
  padrão), com você revisando. Não confie no julgamento dela.
- Passou 1, 2, 3, 7 → dá para usar nos blocos do plano completo
  (`docs/plano-auditoria-seguranca.md`), ainda conferindo os achados.

---

# 5. Se ela reprovar

Não insista com o mesmo modelo. Opções, em ordem de esforço:

1. **Fatiar mais** — dar uma área por vez, com o trecho de código já colado no prompt. A
   maioria dos modelos locais falha por contexto, não por incompetência.
2. **Usar a IA local só para trabalho mecânico** (listar, agrupar, buscar padrão) e deixar
   o julgamento com você ou comigo.
3. **Eu executo os blocos críticos** (B1 e B12 do plano completo) e você usa a IA local
   para os blocos de baixo risco.

**Vale registrar:** o achado mais grave já encontrado neste projeto — usuário trocava o
próprio `account_id` e passava a escrever na conta de outro cliente — exigia entender o
modelo de tenancy, ligar três pedaços de código distantes entre si, e desconfiar de uma
policy que *parecia* correta. É um teste duro para modelo local pequeno. Se ela não passar,
isso é esperado, não é fracasso seu.
