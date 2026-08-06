import { Link, type LayoutProps } from "demiurge";
import { routes } from "../app-routes";

export default function RootLayout({ children }: LayoutProps) {
  return (
    <div>
      <header className="site-header">
        <Link className="brand" to={routes.home()}>
          Demiurge
        </Link>
        <nav>
          <Link to={routes.home()}>Home</Link>
          <Link to={routes.blog.index()}>Blog</Link>
          <Link to={routes.blog.post({ slug: "file-based-routing" })}>
            Dynamic route
          </Link>
        </nav>
      </header>
      {children}
    </div>
  );
}
