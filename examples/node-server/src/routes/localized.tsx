import { Link, defineMetadata, page, type RouteProps } from "@demiurgejs/core";
import { translate } from "../localization";

export const metadata = ({ locale }: RouteProps<"/localized">) =>
  defineMetadata({
    description: translate(locale, "heading"),
    title: translate(locale, "heading"),
  });

export const GET = page({
  view: LocalizedPage,
});

function LocalizedPage({ locale }: RouteProps<"/localized">) {
  const nextLocale = locale === "fr" ? "en" : "fr";

  return (
    <main>
      <h1>{translate(locale, "heading")}</h1>
      <p data-active-locale={locale}>{locale}</p>
      <Link locale={nextLocale} to="/localized">
        {translate(locale, "switch")}
      </Link>
    </main>
  );
}
