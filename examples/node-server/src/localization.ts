import i18next from "i18next";
import { defineLocales, type LocaleResolver } from "@demiurgejs/core";

const resolver: LocaleResolver<"en" | "fr"> = ({ defaultResolution }) =>
  defaultResolution;

export const locales = defineLocales({
  defaultLocale: "en",
  path: { labels: { en: "en", fr: "fr" } },
  resolver,
  supportedLocales: ["en", "fr"],
  xDefault: "en",
});

const messages = i18next.createInstance();
void messages.init({
  fallbackLng: "en",
  initAsync: false,
  resources: {
    en: { translation: { heading: "Localized application", switch: "View in French" } },
    fr: { translation: { heading: "Application localisée", switch: "Voir en anglais" } },
  },
});

export function translate(locale: string | undefined, key: "heading" | "switch") {
  return messages.t(key, { lng: locale ?? locales.defaultLocale });
}
