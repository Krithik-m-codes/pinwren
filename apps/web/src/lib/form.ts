/** A text field from a submitted form; missing fields and file inputs read as "". */
export function formText(form: FormData, name: string): string {
  const v = form.get(name);
  return typeof v === "string" ? v : "";
}

/** A Base UI slider's value as one number (single-thumb sliders report `number | readonly number[]`). */
export function sliderValue(v: number | readonly number[]): number {
  return typeof v === "number" ? v : (v[0] ?? 0);
}
