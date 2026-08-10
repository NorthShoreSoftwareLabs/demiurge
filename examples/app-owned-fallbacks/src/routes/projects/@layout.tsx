import type { LayoutProps } from "demiurge";

export default function ProjectLayout({ children }: LayoutProps) {
  return (
    <section className="project-shell" data-layout-owner="projects">
      <p className="section-label">Project workspace</p>
      {children}
    </section>
  );
}
