import { describe, expect, it } from 'vitest';

import {
  ehRuidoDeProtocolo,
  getEvolutionIncomingMedia,
  parseEvolutionMessageContent,
  resolveEvolutionChatJid,
} from './evolution-webhook-message';

describe('resolveEvolutionChatJid', () => {
  it('mantém o JID telefônico normal', () => {
    expect(
      resolveEvolutionChatJid({
        key: { remoteJid: '5511999999999@s.whatsapp.net', fromMe: false },
      })
    ).toBe('5511999999999@s.whatsapp.net');
  });

  it('usa remoteJidAlt quando o identificador principal é um LID', () => {
    expect(
      resolveEvolutionChatJid({
        key: {
          remoteJid: '123456789012345@lid',
          remoteJidAlt: '5511999999999@s.whatsapp.net',
          fromMe: true,
        },
      })
    ).toBe('5511999999999@s.whatsapp.net');
  });

  it('não transforma um LID opaco em telefone', () => {
    expect(
      resolveEvolutionChatJid({
        key: { remoteJid: '123456789012345@lid', fromMe: false },
      })
    ).toBeNull();
  });
});

describe('parseEvolutionMessageContent', () => {
  it('extrai texto simples e texto citado', () => {
    expect(
      parseEvolutionMessageContent({ message: { conversation: 'Olá' } })
    ).toEqual({ contentType: 'text', text: 'Olá' });
    expect(
      parseEvolutionMessageContent({
        message: { extendedTextMessage: { text: 'Resposta' } },
      })
    ).toEqual({ contentType: 'text', text: 'Resposta' });
  });

  it('mantém mídias visíveis no histórico mesmo sem download', () => {
    expect(
      parseEvolutionMessageContent({ message: { audioMessage: {} } })
    ).toEqual({ contentType: 'audio', text: '[áudio]' });
    expect(
      parseEvolutionMessageContent({
        message: { imageMessage: { caption: 'Comprovante' } },
      })
    ).toEqual({ contentType: 'image', text: 'Comprovante' });
  });

  it('extrai base64, MIME e nome do arquivo recebidos pela Evolution', () => {
    expect(
      getEvolutionIncomingMedia({
        message: {
          documentMessage: {
            fileName: 'contrato.pdf',
            mimetype: 'application/pdf',
          },
          base64: 'YWJj',
        },
      })
    ).toEqual({
      base64: 'YWJj',
      mimeType: 'application/pdf',
      fileName: 'contrato.pdf',
    });
  });

  it('desembrulha mídia temporária/view-once sem perder o base64 da raiz', () => {
    const message = {
      message: {
        base64: 'aW1hZ2Vt',
        viewOnceMessageV2: {
          message: {
            imageMessage: {
              caption: 'Foto',
              mimetype: 'image/jpeg',
            },
          },
        },
      },
    };
    expect(parseEvolutionMessageContent(message)).toEqual({
      contentType: 'image',
      text: 'Foto',
    });
    expect(getEvolutionIncomingMedia(message)).toEqual({
      base64: 'aW1hZ2Vt',
      mimeType: 'image/jpeg',
      fileName: null,
    });
  });
});

// ---------------------------------------------------------------------------
// Ruído de protocolo.
//
// Números da Evolution de produção: 16 de 200 mensagens (8%) viravam
// bolha vazia "[mensagem]" no inbox — 11 reações e 5 mensagens internas
// do WhatsApp. O atendente via conversa nova onde ninguém falou nada.
//
// O teste que mais importa aqui é o do MEIO: reação grudada numa
// mensagem de verdade. O `senderKeyDistributionMessage` vem junto com
// texto normal o tempo todo, e descartar pelo acompanhante apagaria a
// mensagem real do cliente — que é muito pior do que a bolha vazia.
// ---------------------------------------------------------------------------
describe("ehRuidoDeProtocolo", () => {
  it("reação sozinha é ruído", () => {
    expect(
      ehRuidoDeProtocolo({
        message: { reactionMessage: { text: "👍" } },
      } as never)
    ).toBe(true);
  });

  it("tráfego interno do WhatsApp é ruído", () => {
    expect(
      ehRuidoDeProtocolo({
        message: { senderKeyDistributionMessage: {} },
      } as never)
    ).toBe(true);
    expect(
      ehRuidoDeProtocolo({ message: { secretEncryptedMessage: {} } } as never)
    ).toBe(true);
    expect(
      ehRuidoDeProtocolo({ message: { protocolMessage: {} } } as never)
    ).toBe(true);
  });

  it("mensagem REAL com ruído grudado NÃO é descartada", () => {
    // Este é o caso que não pode falhar: perder a mensagem do cliente
    // porque veio acompanhada de tráfego interno seria trocar um
    // incômodo por um prejuízo.
    expect(
      ehRuidoDeProtocolo({
        message: {
          conversation: "oi, tudo bem?",
          senderKeyDistributionMessage: {},
        },
      } as never)
    ).toBe(false);
  });

  it("mídia com ruído grudado NÃO é descartada", () => {
    expect(
      ehRuidoDeProtocolo({
        message: {
          imageMessage: { mimetype: "image/jpeg" },
          senderKeyDistributionMessage: {},
        },
      } as never)
    ).toBe(false);
  });

  it("tipo desconhecido NÃO é descartado — continua visível", () => {
    // Localização, cartão de contato e enquete não estão na lista de
    // ruído. Aparecem como "[mensagem]": feio, mas visível — e visível
    // é recuperável, enquanto descartado é perda silenciosa.
    expect(
      ehRuidoDeProtocolo({ message: { locationMessage: {} } } as never)
    ).toBe(false);
    expect(
      ehRuidoDeProtocolo({ message: { pollCreationMessage: {} } } as never)
    ).toBe(false);
  });

  it("mensagem vazia não é tratada como ruído", () => {
    expect(ehRuidoDeProtocolo({ message: {} } as never)).toBe(false);
    expect(ehRuidoDeProtocolo({} as never)).toBe(false);
  });
});
