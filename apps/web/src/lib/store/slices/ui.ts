import { createSlice, type PayloadAction } from "@reduxjs/toolkit";

/** App-wide overlays that any screen (or the keyboard) can open. */
export type UiState = {
  paletteOpen: boolean;
  shortcutsOpen: boolean;
};

export const initialUiState: UiState = { paletteOpen: false, shortcutsOpen: false };

export const uiSlice = createSlice({
  name: "ui",
  initialState: initialUiState,
  reducers: {
    paletteToggled(state, action: PayloadAction<boolean | undefined>) {
      state.paletteOpen = action.payload ?? !state.paletteOpen;
    },
    shortcutsToggled(state, action: PayloadAction<boolean | undefined>) {
      state.shortcutsOpen = action.payload ?? !state.shortcutsOpen;
    },
  },
});

export const { paletteToggled, shortcutsToggled } = uiSlice.actions;
