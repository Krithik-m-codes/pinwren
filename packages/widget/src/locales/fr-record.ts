// fr translation of en-record.ts ("Record screen", widget-record.js); keep keys and {placeholders} identical.
import type { RecordCatalog } from "../i18n";

export default {
  recAdd: "Enregistrer l'écran",
  recTitle: "Enregistrez votre écran",
  recIntro:
    "Montrez le problème au moment où il se produit. L'enregistrement capture cet onglet du navigateur : tout ce qui y est visible est inclus.",
  recPoint1: "Rien n'est envoyé tant que vous n'envoyez pas le rapport.",
  recPoint2: "Les champs marqués comme privés sur la page ne sont pas masqués dans un enregistrement.",
  recLimit: "Durée maximale : {time}. L'enregistrement s'arrête tout seul.",
  recMic: "Ajouter un commentaire vocal",
  recMicNote: "Votre navigateur vous demandera l'autorisation d'utiliser le micro.",
  recStart: "Démarrer l'enregistrement",
  recCountdown: "L'enregistrement démarre dans {n}",
  recHidden:
    "Placez le pointeur dans le coin inférieur gauche ou appuyez sur Alt+Maj+S pour arrêter. Les commandes ne sont pas enregistrées.",
  recBar: "Commandes de l'enregistrement d'écran",
  recRecording: "Enregistrement",
  recPaused: "En pause",
  recPause: "Mettre l'enregistrement en pause",
  recResume: "Reprendre l'enregistrement",
  recStop: "Arrêter l'enregistrement",
  recTime: "{time} sur {max}",
  recWindow: "Enregistrement",
  recPreviewTitle: "Vérifiez votre enregistrement",
  recPreviewLabel: "Aperçu de votre enregistrement",
  recRetake: "Recommencer",
  recDiscard: "Supprimer",
  recAttach: "Joindre l'enregistrement",
  recAttached: "Enregistrement joint",
  recRemove: "Retirer l'enregistrement",
  recRow: "Enregistrement d'écran · {time}",
  recRowVoice: "Enregistrement d'écran avec voix · {time}",
  recPlay: "Lire l'enregistrement",
  recLimitTime: "L'enregistrement a atteint la durée maximale ({time}) et a été arrêté.",
  recLimitSize: "L'enregistrement a atteint la limite de taille et a été arrêté.",
  recMicOff: "Le micro n'est pas disponible : cet enregistrement n'a pas de son.",
  recDenied:
    "L'enregistrement d'écran a été annulé ou bloqué. Autorisez-le dans votre navigateur et réessayez.",
  recUnsupported:
    "Ce navigateur ne peut pas enregistrer l'écran. Essayez la version de bureau de Chrome, Edge, Firefox ou Safari.",
  recFailed: "L'enregistrement a échoué. Réessayez.",
  recTooBig: "Cet enregistrement est trop volumineux pour être joint. Faites-en un plus court.",
} satisfies RecordCatalog;
