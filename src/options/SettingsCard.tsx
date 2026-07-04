import React from "react";
import { classNames } from "./classNames";

type SettingsCardProps = Omit<React.HTMLAttributes<HTMLElement>, "title"> & {
  actions?: React.ReactNode;
  children?: React.ReactNode;
  headerAside?: React.ReactNode;
  subtitle?: React.ReactNode;
  title: React.ReactNode;
  variant?: "default" | "unavailable" | "danger";
};

export const SettingsCard = React.forwardRef<HTMLElement, SettingsCardProps>(function SettingsCard(
  { actions, children, className, headerAside, subtitle, title, variant = "default", ...sectionProps },
  ref
) {
  const variantClass = variant === "default" ? null : `settings-card-${variant}`;
  const trailing = headerAside ?? actions;
  return (
    <section {...sectionProps} ref={ref} className={classNames("panel settings-card", variantClass, className)}>
      <div className={classNames("settings-card-header")}>
        <div className={classNames("settings-card-title-block")}>
          <h2>{title}</h2>
          {subtitle ? <p className={classNames("panel-subtitle")}>{subtitle}</p> : null}
        </div>
        {trailing ? <div className={classNames("settings-card-actions")}>{trailing}</div> : null}
      </div>
      {children ? <div className={classNames("settings-card-body")}>{children}</div> : null}
    </section>
  );
});
