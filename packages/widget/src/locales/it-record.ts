// it translation of en-record.ts ("Record screen", widget-record.js); keep keys and {placeholders} identical.
import type { RecordCatalog } from "../i18n";

export default {
  recAdd: "Registra schermo",
  recTitle: "Registra il tuo schermo",
  recIntro:
    "Mostra il problema mentre accade. La registrazione cattura questa scheda del browser, quindi è incluso tutto ciò che vi è visibile.",
  recPoint1: "Non viene caricato nulla finché non invii la segnalazione.",
  recPoint2: "I campi contrassegnati come privati nella pagina non vengono nascosti in una registrazione.",
  recLimit: "Durata massima: {time}. La registrazione si interrompe da sola.",
  recMic: "Aggiungi commento vocale",
  recMicNote: "Il browser chiederà il permesso di usare il microfono.",
  recStart: "Avvia registrazione",
  recCountdown: "La registrazione inizia tra {n}",
  recHidden:
    "Sposta il puntatore nell'angolo in basso a sinistra o premi Alt+Maiusc+S per fermare. I controlli non vengono registrati.",
  recBar: "Controlli della registrazione dello schermo",
  recRecording: "Registrazione in corso",
  recPaused: "In pausa",
  recPause: "Metti in pausa la registrazione",
  recResume: "Riprendi la registrazione",
  recStop: "Ferma la registrazione",
  recTime: "{time} di {max}",
  recWindow: "Registrazione",
  recPreviewTitle: "Controlla la registrazione",
  recPreviewLabel: "Anteprima della registrazione",
  recRetake: "Registra di nuovo",
  recDiscard: "Scarta",
  recAttach: "Allega registrazione",
  recAttached: "Registrazione allegata",
  recRemove: "Rimuovi registrazione",
  recRow: "Registrazione dello schermo · {time}",
  recRowVoice: "Registrazione dello schermo con voce · {time}",
  recPlay: "Riproduci registrazione",
  recLimitTime: "La registrazione ha raggiunto la durata massima ({time}) ed è stata interrotta.",
  recLimitSize: "La registrazione ha raggiunto il limite di dimensione ed è stata interrotta.",
  recMicOff: "Il microfono non è disponibile, quindi questa registrazione non ha audio.",
  recDenied: "La registrazione dello schermo è stata annullata o bloccata. Consentila nel browser e riprova.",
  recUnsupported:
    "Questo browser non può registrare lo schermo. Prova la versione desktop di Chrome, Edge, Firefox o Safari.",
  recFailed: "Registrazione non riuscita. Riprova.",
  recTooBig: "La registrazione è troppo grande per essere allegata. Registrane una più breve.",
} satisfies RecordCatalog;
