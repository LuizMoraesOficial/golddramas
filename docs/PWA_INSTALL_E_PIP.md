# Instalação PWA e Picture-in-Picture

## Decisões de implementação

O manifest define nome, ícones 192×192 e 512×512, início na raiz e apresentação `standalone`. Em Chromium, esses campos e HTTPS são necessários para oferecer instalação. O service worker é complementar: ele armazena apenas o shell e os assets estáticos e exclui explicitamente `/api/` e `/media/`. [MDN, requisitos de instalação PWA](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Guides/Making_PWAs_installable)

Em navegadores compatíveis, o botão captura `beforeinstallprompt` e abre o fluxo nativo após o toque do usuário. Esse evento não está disponível no iOS; por isso, o app mostra o caminho manual do Safari: Compartilhar → Adicionar à Tela de Início. [web.dev, prompt de instalação](https://web.dev/learn/pwa/installation-prompt)

O controle de janela flutuante aciona Picture-in-Picture por uma ação explícita do usuário, usando a API padrão quando disponível e o caminho de apresentação WebKit no Safari. PiP mantém o vídeo, não a tela inteira do Drama Reels, sobre outros apps; o suporte depende do navegador, sistema e do formato de mídia. [MDN, API Picture-in-Picture](https://developer.mozilla.org/en-US/docs/Web/API/Picture-in-Picture_API) [Apple WebKit, controles de PiP](https://developer.apple.com/documentation/webkitjs/adding_picture_in_picture_to_your_safari_media_controls)

A página do [WebKit Bug 303885](https://bugs.webkit.org/show_bug.cgi?id=303885) continua com status **NEW** e descreve `requestPictureInPicture()` falhando em PWAs abertas pela Tela de Início, embora funcione no Safari. O relato inclui reproduções em iOS 26.1 beta; portanto, a instalação PWA em iPhone não pode ser apresentada como garantia de PiP. Se a tentativa falhar, o app recomenda abrir a página pelo Safari. [MDN, `requestPictureInPicture()`](https://developer.mozilla.org/en-US/docs/Web/API/HTMLVideoElement/requestPictureInPicture)

## Fontes consultadas

- MDN, requisitos e instalação de PWAs: https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Guides/Making_PWAs_installable
- web.dev, prompt próprio e `beforeinstallprompt`: https://web.dev/learn/pwa/installation-prompt
- MDN, API Picture-in-Picture: https://developer.mozilla.org/en-US/docs/Web/API/Picture-in-Picture_API
- MDN, `HTMLVideoElement.requestPictureInPicture()`: https://developer.mozilla.org/en-US/docs/Web/API/HTMLVideoElement/requestPictureInPicture
- Apple WebKit JS, controle PiP em Safari: https://developer.apple.com/documentation/webkitjs/adding_picture_in_picture_to_your_safari_media_controls
- WebKit Bug 303885, PiP em PWAs iOS/iPadOS: https://bugs.webkit.org/show_bug.cgi?id=303885
