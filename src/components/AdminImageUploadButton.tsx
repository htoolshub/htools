import { Upload } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import {
  ADMIN_IMAGE_UPLOAD_MIME_TYPES,
  getAdminImageUploadValidationCode
} from "../../shared/image-upload";
import { uploadAdminImage } from "../admin-api";
import AdminFieldAssistButton from "./AdminFieldAssistButton";

const ACCEPTED_IMAGE_TYPES = ADMIN_IMAGE_UPLOAD_MIME_TYPES.join(",");

function createValidationError(code: string) {
  return Object.assign(new Error(code), { code });
}

export default function AdminImageUploadButton({
  disabled = false,
  label,
  mobileLabel,
  onError,
  onUploaded,
  token
}: {
  disabled?: boolean;
  label: string;
  mobileLabel: string;
  onError: (error: unknown) => void;
  onUploaded: (url: string) => void;
  token: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const requestRef = useRef<symbol | null>(null);
  const [uploading, setUploading] = useState(false);

  useEffect(() => () => {
    requestRef.current = null;
  }, []);

  async function upload(file: File) {
    if (requestRef.current) return;
    const validationCode = getAdminImageUploadValidationCode(file);
    if (validationCode) {
      onError(createValidationError(validationCode));
      if (inputRef.current) inputRef.current.value = "";
      return;
    }
    const request = Symbol();
    requestRef.current = request;
    setUploading(true);
    try {
      const image = await uploadAdminImage(file, token);
      if (requestRef.current === request) onUploaded(image.url);
    } catch (error) {
      if (requestRef.current === request) onError(error);
    } finally {
      if (requestRef.current === request) {
        requestRef.current = null;
        setUploading(false);
        if (inputRef.current) inputRef.current.value = "";
      }
    }
  }

  return (
    <>
      <input
        accept={ACCEPTED_IMAGE_TYPES}
        aria-hidden="true"
        hidden
        ref={inputRef}
        tabIndex={-1}
        type="file"
        onChange={(event) => {
          const file = event.currentTarget.files?.[0];
          if (file) void upload(file);
        }}
      />
      <AdminFieldAssistButton
        busy={uploading}
        disabled={disabled}
        icon={<Upload size={16} />}
        label={label}
        mobileLabel={mobileLabel}
        onClick={() => inputRef.current?.click()}
      />
    </>
  );
}
