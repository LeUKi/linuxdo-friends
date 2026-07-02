import React, { useContext, useEffect, useState } from "react";
import { AvatarImageContext } from "./AvatarContext";
import type { UserIdentityView } from "../popup/selectors";

export function UserIdentityRow({ identity, compact = false }: { identity: UserIdentityView; compact?: boolean }) {
  const allowRemoteAvatar = useContext(AvatarImageContext);
  const [avatarFailed, setAvatarFailed] = useState(false);
  const shouldRenderImage = identity.avatarUrl && (allowRemoteAvatar || identity.avatarUrl.startsWith("data:image/")) && !avatarFailed;

  useEffect(() => {
    setAvatarFailed(false);
  }, [identity.avatarUrl]);

  return (
    <div className={`identity-row${compact ? " compact-identity" : ""}`}>
      {shouldRenderImage ? (
        <img className="avatar" src={identity.avatarUrl} alt="" onError={() => setAvatarFailed(true)} />
      ) : (
        <span className="avatar avatar-fallback" aria-hidden="true">
          {identity.username.slice(0, 1).toUpperCase()}
        </span>
      )}
      <div className="identity-text">
        <strong>{identity.primary}</strong>
        <span>{identity.secondary}</span>
      </div>
    </div>
  );
}
