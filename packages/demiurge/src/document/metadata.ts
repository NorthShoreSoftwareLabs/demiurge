export type MetadataTitle =
  | string
  | {
      default?: string;
      format?: (title: string) => string;
    };

export type RobotsMetadata = {
  follow?: boolean;
  index?: boolean;
};

export type OpenGraphMetadata = {
  description?: string;
  image?: string;
  title?: string;
};

export type MetaTag = {
  content: string;
  kind: "meta";
  name?: string;
  property?: string;
};

export type LinkTag = {
  as?: string;
  crossOrigin?: "anonymous" | "use-credentials";
  href: string;
  hrefLang?: string;
  kind: "link";
  rel: string;
  type?: string;
};

export type StructuredDataValue =
  | boolean
  | null
  | number
  | string
  | readonly StructuredDataValue[]
  | { readonly [key: string]: StructuredDataValue };

export type StructuredDataTag = {
  kind: "structured-data";
  value: StructuredDataValue;
};

export type Metadata = {
  canonical?: string;
  custom?: readonly DocumentMetadataTag[];
  description?: string;
  openGraph?: OpenGraphMetadata;
  robots?: RobotsMetadata;
  structuredData?: readonly StructuredDataTag[];
  title?: MetadataTitle;
};

export type DocumentMetadataTag = LinkTag | MetaTag;

export type ResolvedMetadata = {
  canonical?: string;
  charset: "utf-8";
  custom: DocumentMetadataTag[];
  description?: string;
  openGraph?: OpenGraphMetadata;
  robots?: RobotsMetadata;
  structuredData: StructuredDataTag[];
  title?: string;
  viewport: "width=device-width, initial-scale=1";
};

export function defineMetadata(metadata: Metadata) {
  return metadata;
}

export function meta(tag: Omit<MetaTag, "kind">): MetaTag {
  return {
    ...tag,
    kind: "meta",
  };
}

export function link(tag: Omit<LinkTag, "kind">): LinkTag {
  return {
    ...tag,
    kind: "link",
  };
}

export function structuredData(value: StructuredDataValue): StructuredDataTag {
  return {
    kind: "structured-data",
    value,
  };
}

export function resolveMetadata(
  ...metadataEntries: Array<Metadata | false | undefined>
): ResolvedMetadata {
  const state: MetadataState = {
    custom: [],
    structuredData: [],
  };

  for (const metadata of metadataEntries) {
    if (!metadata) {
      continue;
    }

    applyMetadata(state, metadata);
  }

  const title = resolveTitle(state);
  const description = state.description;
  const openGraph = resolveOpenGraph(state.openGraph, title, description);

  return {
    canonical: state.canonical,
    charset: "utf-8",
    custom: state.custom,
    description,
    openGraph,
    robots: state.robots,
    structuredData: state.structuredData,
    title,
    viewport: "width=device-width, initial-scale=1",
  };
}

type MetadataState = {
  canonical?: string;
  custom: DocumentMetadataTag[];
  description?: string;
  openGraph?: OpenGraphMetadata;
  robots?: RobotsMetadata;
  structuredData: StructuredDataTag[];
  title?: string;
  titleDefault?: string;
  titleFormat?: (title: string) => string;
};

function applyMetadata(state: MetadataState, metadata: Metadata) {
  applyTitle(state, metadata.title);

  if (metadata.description !== undefined) {
    state.description = metadata.description;
  }

  if (metadata.canonical !== undefined) {
    state.canonical = metadata.canonical;
  }

  if (metadata.robots) {
    state.robots = {
      ...(state.robots ?? {}),
      ...metadata.robots,
    };
  }

  if (metadata.openGraph) {
    state.openGraph = {
      ...(state.openGraph ?? {}),
      ...metadata.openGraph,
    };
  }

  if (metadata.custom) {
    state.custom.push(...metadata.custom);
  }

  if (metadata.structuredData) {
    state.structuredData.push(...metadata.structuredData);
  }
}

function applyTitle(state: MetadataState, title: MetadataTitle | undefined) {
  if (title === undefined) {
    return;
  }

  if (typeof title === "string") {
    state.title = title;
    return;
  }

  if (title.default !== undefined) {
    state.titleDefault = title.default;
  }

  if (title.format) {
    state.titleFormat = title.format;
  }
}

function resolveTitle(state: MetadataState) {
  // A default title stands on its own. Only a title supplied by a route runs
  // through the inherited formatter, otherwise a layout that declares both ends
  // up rendering its own name twice on every route that sets no title.
  if (state.title === undefined) {
    return state.titleDefault;
  }

  return state.titleFormat ? state.titleFormat(state.title) : state.title;
}

function resolveOpenGraph(
  openGraph: OpenGraphMetadata | undefined,
  title: string | undefined,
  description: string | undefined,
) {
  if (!openGraph && !title && !description) {
    return undefined;
  }

  return {
    ...(title ? { title } : {}),
    ...(description ? { description } : {}),
    ...(openGraph ?? {}),
  };
}
