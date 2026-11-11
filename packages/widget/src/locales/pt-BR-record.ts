// pt-BR translation of en-record.ts ("Record screen", widget-record.js); keep keys and {placeholders} identical.
import type { RecordCatalog } from "../i18n";

export default {
  recAdd: "Gravar tela",
  recTitle: "Grave sua tela",
  recIntro:
    "Mostre o problema enquanto ele acontece. A gravação captura esta aba do navegador, então tudo o que estiver visível nela é incluído.",
  recPoint1: "Nada é enviado até você enviar o relatório.",
  recPoint2: "Campos marcados como privados na página não ficam ocultos em uma gravação.",
  recLimit: "Duração máxima: {time}. A gravação para sozinha.",
  recMic: "Adicionar narração de voz",
  recMicNote: "Seu navegador vai pedir permissão para usar o microfone.",
  recStart: "Iniciar gravação",
  recCountdown: "A gravação começa em {n}",
  recHidden:
    "Mova o ponteiro para o canto inferior esquerdo ou pressione Alt+Shift+S para parar. Os controles não são gravados.",
  recBar: "Controles da gravação de tela",
  recRecording: "Gravando",
  recPaused: "Em pausa",
  recPause: "Pausar gravação",
  recResume: "Retomar gravação",
  recStop: "Parar gravação",
  recTime: "{time} de {max}",
  recWindow: "Gravando",
  recPreviewTitle: "Revise sua gravação",
  recPreviewLabel: "Pré-visualização da sua gravação",
  recRetake: "Gravar de novo",
  recDiscard: "Descartar",
  recAttach: "Anexar gravação",
  recAttached: "Gravação anexada",
  recRemove: "Remover gravação",
  recRow: "Gravação de tela · {time}",
  recRowVoice: "Gravação de tela com voz · {time}",
  recPlay: "Reproduzir gravação",
  recLimitTime: "A gravação atingiu a duração máxima ({time}) e foi interrompida.",
  recLimitSize: "A gravação atingiu o limite de tamanho e foi interrompida.",
  recMicOff: "O microfone não está disponível, então esta gravação não tem som.",
  recDenied: "A gravação de tela foi cancelada ou bloqueada. Permita-a no navegador e tente novamente.",
  recUnsupported:
    "Este navegador não consegue gravar a tela. Experimente a versão para computador do Chrome, Edge, Firefox ou Safari.",
  recFailed: "A gravação falhou. Tente novamente.",
  recTooBig: "Essa gravação é grande demais para ser anexada. Grave uma mais curta.",
} satisfies RecordCatalog;
