import { ChevronDown } from "lucide-react";
import type { ReactNode } from "react";
import type { useAdminCardActionMenu } from "../useAdminCardActionMenu";

type AdminCardMenuItem = {
  key: string;
  label: string;
  shortLabel: string;
  icon: ReactNode;
  disabled?: boolean;
  danger?: boolean;
  onSelect: () => void;
};

export function AdminCardActionMenu({
  actions,
  items,
  label,
  triggerDisabled = false
}: {
  actions: ReturnType<typeof useAdminCardActionMenu>;
  items: AdminCardMenuItem[];
  label: string;
  triggerDisabled?: boolean;
}) {
  return (
    <>
      <button
        aria-expanded={actions.open}
        aria-haspopup="menu"
        aria-label={label}
        className={`icon-button admin-tool-menu-trigger ${actions.open ? "is-active" : ""}`.trim()}
        disabled={triggerDisabled}
        ref={actions.triggerRef}
        type="button"
        onClick={() => actions.setOpen((current) => !current)}
        onKeyDown={actions.handleTriggerKeyDown}
      >
        <ChevronDown size={17} />
      </button>
      {actions.open ? (
        <div
          aria-label={label}
          className="admin-tool-action-menu"
          onKeyDown={actions.handleMenuKeyDown}
          role="menu"
        >
          {items.map((item) => (
            <button
              className={item.danger ? "danger" : undefined}
              disabled={item.disabled}
              key={item.key}
              role="menuitem"
              type="button"
              onClick={() => {
                actions.close();
                item.onSelect();
              }}
            >
              {item.icon}
              <span className="admin-action-label-full">{item.label}</span>
              <span className="admin-action-label-short">{item.shortLabel}</span>
            </button>
          ))}
        </div>
      ) : null}
    </>
  );
}
