'use client';

import type { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { Check } from 'lucide-react';

import { cn } from '@/lib/utils';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

export interface ClientSetupStep {
  id: number;
  label: string;
  description: string;
  icon: LucideIcon;
  optional?: boolean;
}

export function ClientSetupDialog({
  open,
  onOpenChange,
  accountName,
  title,
  steps,
  activeStep,
  canNavigate,
  onStepChange,
  children,
  footer,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  accountName: string;
  title: string;
  steps: ClientSetupStep[];
  activeStep: number;
  canNavigate: (step: number) => boolean;
  onStepChange: (step: number) => void;
  children: ReactNode;
  footer: ReactNode;
}) {
  const current = steps.find((step) => step.id === activeStep) ?? steps[0];
  const requiredSteps = steps.filter((step) => !step.optional);
  const position = requiredSteps.findIndex((step) => step.id === activeStep);
  const requiredPosition = position < 0 ? requiredSteps.length : position + 1;
  const progress = Math.round((requiredPosition / requiredSteps.length) * 100);
  const initial =
    accountName.trim().charAt(0).toLocaleUpperCase('pt-BR') || 'C';

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="border-border bg-popover flex max-h-[calc(100dvh-2rem)] flex-col gap-0 overflow-hidden p-0 sm:max-w-5xl">
        <DialogHeader className="border-border shrink-0 border-b px-5 py-4 pr-14 sm:px-6">
          <div className="flex items-center gap-3">
            <div className="bg-primary/10 text-primary flex size-10 shrink-0 items-center justify-center rounded-xl text-sm font-semibold">
              {initial}
            </div>
            <div className="min-w-0">
              <DialogTitle className="truncate text-lg">{title}</DialogTitle>
              <DialogDescription className="truncate">
                {accountName.trim() || 'Nova conta de cliente'}
              </DialogDescription>
            </div>
            <span className="text-muted-foreground ml-auto hidden text-xs font-medium sm:block">
              {progress}% concluído
            </span>
          </div>
          <div
            className="bg-muted mt-3 h-1.5 overflow-hidden rounded-full"
            role="progressbar"
            aria-label="Progresso da configuração"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={progress}
          >
            <div
              className="bg-primary h-full rounded-full transition-[width] duration-300"
              style={{ width: `${progress}%` }}
            />
          </div>
        </DialogHeader>

        <div className="grid min-h-0 flex-1 md:grid-cols-[224px_minmax(0,1fr)]">
          <nav
            aria-label="Etapas da configuração do cliente"
            className="border-border bg-muted/25 flex shrink-0 gap-2 overflow-x-auto border-b p-3 md:flex-col md:overflow-x-visible md:border-r md:border-b-0 md:p-4"
          >
            {steps.map((step) => {
              const Icon = step.icon;
              const active = step.id === activeStep;
              const complete = step.id < activeStep;
              const enabled = canNavigate(step.id);

              return (
                <div
                  key={step.id}
                  className={
                    step.optional
                      ? 'md:border-border md:mt-3 md:border-t md:pt-4'
                      : ''
                  }
                >
                  <button
                    type="button"
                    onClick={() => onStepChange(step.id)}
                    disabled={!enabled}
                    aria-current={active ? 'step' : undefined}
                    className={cn(
                      'flex w-full min-w-40 items-start gap-3 rounded-lg border px-3 py-2.5 text-left transition-colors md:min-w-0',
                      active
                        ? 'border-primary/40 bg-primary/10 text-foreground'
                        : 'text-muted-foreground hover:border-border hover:bg-background/70 hover:text-foreground border-transparent',
                      !enabled &&
                        'cursor-not-allowed opacity-45 hover:border-transparent hover:bg-transparent'
                    )}
                  >
                    <span
                      className={cn(
                        'mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full border text-[11px] font-semibold',
                        active &&
                          'border-primary bg-primary text-primary-foreground',
                        complete &&
                          'border-emerald-500 bg-emerald-500 text-white'
                      )}
                    >
                      {complete && !step.optional ? (
                        <Check className="size-3.5" />
                      ) : (
                        <Icon className="size-3.5" />
                      )}
                    </span>
                    <span className="min-w-0">
                      <span className="flex items-center gap-1.5 text-sm font-medium">
                        {step.label}
                        {step.optional ? (
                          <span className="rounded-full bg-violet-500 px-1.5 py-0.5 text-[9px] font-semibold text-white">
                            Opcional
                          </span>
                        ) : null}
                      </span>
                      <span className="text-muted-foreground mt-0.5 hidden text-xs leading-4 md:block">
                        {step.description}
                      </span>
                    </span>
                  </button>
                </div>
              );
            })}
          </nav>

          <section
            aria-labelledby="client-setup-step-title"
            className="min-h-0 overflow-y-auto"
          >
            <div className="p-5 sm:p-6">
              <div className="mb-5">
                <p className="text-primary text-xs font-medium tracking-wide uppercase">
                  {current.optional
                    ? 'Configurações opcionais'
                    : `Etapa ${activeStep} de ${requiredSteps.length}`}
                </p>
                <h2
                  id="client-setup-step-title"
                  className="text-foreground mt-1 text-xl font-semibold tracking-tight"
                >
                  {current.label}
                </h2>
                <p className="text-muted-foreground mt-1 text-sm">
                  {current.description}
                </p>
              </div>
              {children}
            </div>
          </section>
        </div>

        <footer className="border-border bg-muted/25 flex shrink-0 items-center justify-end gap-2 border-t px-5 py-3 sm:px-6">
          {footer}
        </footer>
      </DialogContent>
    </Dialog>
  );
}
