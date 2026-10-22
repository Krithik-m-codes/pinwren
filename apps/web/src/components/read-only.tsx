"use client";

import { createContext, useContext } from "react";

const ReadOnlyContext = createContext(false);

/**
 * Everything inside renders read-only (viewer role, wave-4 §4): the design-system controls (switches,
 * selects, sliders, checkboxes) read this and disable themselves, the way a disabled <fieldset> disables
 * native inputs. The API refuses a viewer's writes regardless (403 READ_ONLY_ROLE).
 */
export function ReadOnly({ when, children }: { when: boolean; children: React.ReactNode }) {
  return (
    <ReadOnlyContext value={when}>
      <fieldset disabled={when} className="contents">
        {children}
      </fieldset>
    </ReadOnlyContext>
  );
}

export const useReadOnly = () => useContext(ReadOnlyContext);
