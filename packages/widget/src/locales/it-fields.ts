// it translation of en-fields.ts (custom questions, widget-fields.js); keep keys and {placeholders} identical.
import type { FieldsCatalog } from "../i18n";

export default {
  cfHeading: "Altri dettagli",
  cfChoose: "Scegli…",
  cfRequired: "Questa risposta è obbligatoria",
  cfTooShort: "Lunghezza minima: {n}",
  cfTooLong: "Lunghezza massima: {n}",
  cfBadEmail: "Inserisci un indirizzo e-mail valido",
  cfBadUrl: "Inserisci un link che inizi con http:// o https://",
  cfBadNumber: "Inserisci un numero",
  cfNotInteger: "Inserisci un numero intero",
  cfMin: "Minimo: {n}",
  cfMax: "Massimo: {n}",
  cfBadDate: "Inserisci una data valida",
  cfTooFew: "Scegli almeno: {n}",
  cfTooMany: "Scegli al massimo: {n}",
  cfFix: "Controlla le risposte evidenziate",
} satisfies FieldsCatalog;
