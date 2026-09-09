import type { HttpMethod } from "../route";
import type {
  DocumentCspState,
  RouteAccessState,
  StaticPolicyFinding,
} from "../vite/policy-verification";

/**
 * The version of the static policy report. ADR 0019 raises this integer when
 * the framework removes a field or changes the meaning of a field.
 */
export const STATIC_POLICY_REPORT_VERSION = 1;

/**
 * The version of the problem document that the inspect command writes when it
 * cannot produce a report.
 */
export const INSPECTION_PROBLEM_VERSION = 1;

/**
 * The origin of one fact in a report. The value `static` states that the build
 * knows the fact. The value `request` states that only a request supplies it.
 */
export type InspectionResolution = "request" | "static";

/** The rule that removed one value from a report. */
export type InspectionRedactionReason =
  /** A cookie holds the value. */
  | "cookie-value"
  /** An `env.secret(...)` declaration produced the value. */
  | "environment-secret"
  /** A session record holds the value. */
  | "session-record";

/** One value that the serializer removed from a report. */
export type InspectionRedaction = {
  /** The name of the field that held the value. */
  name: string;
  /** The dotted path of the field inside the report. */
  path: string;
  /** The rule that removed the value. */
  reason: InspectionRedactionReason;
};

/** The named sections of the static policy report. */
export type StaticPolicyReportSection =
  | "findings"
  | "redactions"
  | "request"
  | "routes";

/** The kind of route file that the static pass read. */
export type StaticRouteKind = "attached" | "page" | "resource";

/**
 * The statically readable description of one route file.
 *
 * Each declared field states what the file itself declares. The framework
 * resolves the cascade of the route tree and reports the result of the
 * cascade in the `findings` section.
 */
export type StaticRouteReport = {
  /** The access state that the route file declares. */
  declaredAccess: RouteAccessState;
  /** The Content-Security-Policy state that the route file declares. */
  declaredDocumentCsp: DocumentCspState;
  /** `true` when the route file declares a document policy. */
  declaresDocumentPolicy: boolean;
  /** The path of the route file, relative to the route directory. */
  file: string;
  /** The kind of the route file. */
  kind: StaticRouteKind;
  /** The HTTP methods that the route file exports. */
  methods: HttpMethod[];
  /** The route pattern. An attached file has no pattern. */
  pattern?: string;
};

/**
 * The report that `demiurge inspect` writes to standard output. Each section
 * states the resolution of its facts in the `resolutions` record.
 */
export type StaticPolicyReport = {
  /** The static policy findings, sorted by file, export name, and code. */
  findings: StaticPolicyFinding[];
  /** The values that the serializer removed. */
  redactions: InspectionRedaction[];
  /** The names of the facts that only a request supplies. */
  request: string[];
  /** The resolution of each section of the report. */
  resolutions: Record<StaticPolicyReportSection, InspectionResolution>;
  /** Every route file under the route directory. */
  routes: StaticRouteReport[];
  /** The route directory, relative to the project root. */
  routesDir: string;
  /** The version of this report shape. */
  version: number;
};

/** The reason that the inspect command could not produce a report. */
export type InspectionProblemCode =
  /** The framework could not read the configuration. */
  | "configuration-unreadable"
  /** The command received an invalid argument. */
  | "invalid-argument";

/**
 * The document that the inspect command writes when it cannot produce a
 * report. The command then exits with code 2.
 */
export type InspectionProblem = {
  /** The stable code of the condition. */
  code: InspectionProblemCode;
  /** The description of the condition. */
  detail: string;
  /** The short name of the condition. */
  title: string;
  /** The version of this problem shape. */
  version: number;
};
