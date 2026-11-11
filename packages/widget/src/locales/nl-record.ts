// nl translation of en-record.ts ("Record screen", widget-record.js); keep keys and {placeholders} identical.
import type { RecordCatalog } from "../i18n";

export default {
  recAdd: "Scherm opnemen",
  recTitle: "Neem je scherm op",
  recIntro:
    "Laat het probleem zien terwijl het gebeurt. De opname legt dit browsertabblad vast, dus alles wat erin zichtbaar is, zit erbij.",
  recPoint1: "Er wordt niets geüpload voordat je het rapport verstuurt.",
  recPoint2: "Velden die op de pagina als privé zijn gemarkeerd, worden in een opname niet verborgen.",
  recLimit: "Maximale lengte: {time}. De opname stopt vanzelf.",
  recMic: "Voice-over toevoegen",
  recMicNote: "Je browser vraagt om toestemming om de microfoon te gebruiken.",
  recStart: "Opname starten",
  recCountdown: "De opname begint over {n}",
  recHidden:
    "Beweeg de aanwijzer naar de linkerbenedenhoek of druk op Alt+Shift+S om te stoppen. De knoppen worden niet opgenomen.",
  recBar: "Bediening van de schermopname",
  recRecording: "Opnemen",
  recPaused: "Gepauzeerd",
  recPause: "Opname pauzeren",
  recResume: "Opname hervatten",
  recStop: "Opname stoppen",
  recTime: "{time} van {max}",
  recWindow: "Opname",
  recPreviewTitle: "Controleer je opname",
  recPreviewLabel: "Voorbeeld van je opname",
  recRetake: "Opnieuw opnemen",
  recDiscard: "Weggooien",
  recAttach: "Opname bijvoegen",
  recAttached: "Opname bijgevoegd",
  recRemove: "Opname verwijderen",
  recRow: "Schermopname · {time}",
  recRowVoice: "Schermopname met stem · {time}",
  recPlay: "Opname afspelen",
  recLimitTime: "De opname heeft de maximale lengte ({time}) bereikt en is gestopt.",
  recLimitSize: "De opname heeft de groottelimiet bereikt en is gestopt.",
  recMicOff: "De microfoon is niet beschikbaar, dus deze opname heeft geen geluid.",
  recDenied: "Schermopname is geannuleerd of geblokkeerd. Sta het toe in je browser en probeer het opnieuw.",
  recUnsupported:
    "Deze browser kan het scherm niet opnemen. Probeer de desktopversie van Chrome, Edge, Firefox of Safari.",
  recFailed: "De opname is mislukt. Probeer het opnieuw.",
  recTooBig: "Deze opname is te groot om bij te voegen. Neem een kortere op.",
} satisfies RecordCatalog;
