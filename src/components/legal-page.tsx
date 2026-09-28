import Link from "next/link";

type LegalSection = {
  title: string;
  body: string[];
};

export function LegalPage({
  title,
  description,
  sections,
}: {
  title: string;
  description: string;
  sections: LegalSection[];
}) {
  return (
    <main className="min-h-screen bg-background text-foreground">
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-8 px-5 py-12 sm:px-6">
        <header className="flex flex-col gap-3">
          <Link
            href="/"
            className="text-muted-foreground w-fit text-sm transition-colors hover:text-foreground"
          >
            OpenCRM
          </Link>
          <div className="flex flex-col gap-2">
            <h1 className="font-display text-3xl font-semibold tracking-tight sm:text-4xl">
              {title}
            </h1>
            <p className="text-muted-foreground text-sm leading-6">
              {description}
            </p>
          </div>
        </header>

        <div className="flex flex-col gap-7">
          {sections.map((section) => (
            <section key={section.title} className="flex flex-col gap-2">
              <h2 className="text-lg font-semibold">{section.title}</h2>
              {section.body.map((paragraph) => (
                <p
                  key={paragraph}
                  className="text-muted-foreground text-sm leading-6"
                >
                  {paragraph}
                </p>
              ))}
            </section>
          ))}
        </div>
      </div>
    </main>
  );
}
