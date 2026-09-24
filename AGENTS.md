# Preferências

## Comunicação

- Fale em PT-BR e use inglês em identificadores de código.
- Comece pelo resultado, com linguagem simples e parágrafos curtos.
- Texto que sai no meu nome (PR, comentário, mensagem) usa a minha voz e o formato que eu já uso.
- Se eu entregar um texto para revisar, corrija sem mudar formato nem tom.

## Escopo e autonomia

- Faça o que foi pedido, no escopo pedido.
- Se eu pedir análise, desenho ou só para conversar, mostre onde e como mudaria, sem editar.
- Se eu corrigir o rumo ou disser "calma", pare e refaça só o que eu disse.
- Não trate como decisão minha uma opção que eu não citei.
- Trabalhe local. Commit, push, edição de PR e comentário ou review postado só quando o pedido atual pede.
- Review de PR é somente leitura, a não ser que eu diga o contrário.
- Confirme antes de ação destrutiva que eu não autorizei.
- Não abra app, emulador ou simulador sem eu pedir.
- Se eu pedir só para rodar, abra e pare; eu mesmo testo.
- Se eu pedir para você testar, rode, exercite o fluxo pedido e mostre a evidência do que viu.
- Nunca use subagentes por conta própria; eu digo quando usar.

## Diagnóstico

- Antes de propor causa ou correção, mostre a evidência.
- Não ofereça workaround enquanto a causa real não estiver provada.
- Depois de três correções que falharam, pare e diga qual suposição caiu.

## Código

- Trate todo projeto como greenfield, sem usuários: sem fallback, suporte a legado ou compatibilidade retroativa.
- Exceção: se o projeto disser que tem usuários ou contratos a preservar, mantenha esses contratos.
- Comece pela menor solução que funciona. Adicione dependência e abstração só com necessidade concreta.
- Prefira o recurso nativo do framework e os padrões do projeto a lógica, tipo ou arquivo novo.
- Quando um bug for um padrão, corrija todos os lugares onde ele aparece.
- Comentário é o último recurso: renomeie ou extraia antes. Comente só workaround e armadilha silenciosa.

## Review

- Liste todos os achados, cada um com confiança e severidade.

## Git

- Use SSH nos remotes Git e a assinatura SSH de commit configurada.
- Se autenticação ou assinatura falhar, avise; não troque de transporte nem pule assinatura ou hooks.
- Nunca faça squash de PR que já subiu.
- Commit segue `type(escopo): descrição` em PT-BR, com a descrição estendida em bullets minúsculos, um por linha.
- Cada commit compila e passa nos testes pertinentes, para o `git bisect` funcionar.
- Título e corpo de PR em PT-BR.
- No resto, siga as convenções do repositório.
- Use `GIT_EDITOR=true` quando um comando pode abrir editor.

## Ferramentas

- Texto público de issue ou PR vai para um arquivo temporário; revise e passe com `--body-file`.
- Script Python de apoio, sem ferramenta do repo, roda com `uv`.
