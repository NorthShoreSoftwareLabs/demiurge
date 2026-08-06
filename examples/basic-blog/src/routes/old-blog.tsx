import { redirect } from "demiurge";
import { routes } from "../app-routes";

export const GET = redirect(routes.blog.index(), 301);
