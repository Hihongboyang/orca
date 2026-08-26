import { useEffect, useRef, useState } from 'react'
import { Pencil, Plus, Trash2 } from 'lucide-react'
import type { SshTarget } from '../../../../shared/ssh-types'
import type { SftpWorkspaceProfile } from '../../../../shared/sftp-types'
import { Button } from '../ui/button'
import { Input } from '../ui/input'
import { translate } from '@/i18n/i18n'

type SftpProfilesSectionProps = {
  workspacePath: string
  targets: SshTarget[]
}

type FormState = {
  id: string
  label: string
  targetId: string
  localRoot: string
  defaultRemoteDir: string
}

type FormErrors = Partial<Record<'target' | 'localRoot' | 'defaultRemoteDir', string>>

const EMPTY_FORM: FormState = {
  id: '',
  label: '',
  targetId: '',
  localRoot: '',
  defaultRemoteDir: ''
}

function targetLabelFor(targets: SshTarget[], targetId: string): string {
  const target = targets.find((candidate) => candidate.id === targetId)
  return target ? `${target.username}@${target.host}` : targetId
}

export function SftpProfilesSection({
  workspacePath,
  targets
}: SftpProfilesSectionProps): React.JSX.Element {
  const [profiles, setProfiles] = useState<SftpWorkspaceProfile[]>([])
  const [form, setForm] = useState<FormState | null>(null)
  const [errors, setErrors] = useState<FormErrors>({})
  const [saving, setSaving] = useState(false)
  const mountedRef = useRef(true)

  useEffect(() => {
    mountedRef.current = true
    void window.api.sftp.listProfiles({ workspacePath }).then((loaded) => {
      if (mountedRef.current) {
        setProfiles(loaded)
      }
    })
    const unsubscribe = window.api.sftp.onProfilesChanged((next) => {
      if (mountedRef.current) {
        setProfiles(next)
      }
    })
    return () => {
      mountedRef.current = false
      unsubscribe()
    }
  }, [workspacePath])

  const openForm = (): void => {
    setErrors({})
    setForm({ ...EMPTY_FORM, localRoot: workspacePath })
  }

  // Edit keeps the profile id so save() upserts in place (spec: id stable across renames).
  const startEdit = (profile: SftpWorkspaceProfile): void => {
    setErrors({})
    setForm({
      id: profile.id,
      label: profile.label,
      targetId: profile.targetId,
      localRoot: profile.localRoot,
      defaultRemoteDir: profile.defaultRemoteDir
    })
  }

  const save = async (): Promise<void> => {
    if (!form) {
      return
    }
    const nextErrors: FormErrors = {}
    if (!form.targetId) {
      nextErrors.target = translate(
        'auto.components.settings.SftpProfilesSection.c0a611137d',
        'Pick an SSH target'
      )
    }
    if (!form.defaultRemoteDir.startsWith('/')) {
      nextErrors.defaultRemoteDir = translate(
        'auto.components.settings.SftpProfilesSection.94535e58b0',
        'Must be an absolute path starting with /'
      )
    }
    if (Object.keys(nextErrors).length > 0) {
      setErrors(nextErrors)
      return
    }
    setSaving(true)
    try {
      await window.api.sftp.saveProfile({
        workspacePath,
        profile: {
          id: form.id,
          label: form.label || targetLabelFor(targets, form.targetId),
          targetId: form.targetId,
          localRoot: form.localRoot,
          defaultRemoteDir: form.defaultRemoteDir
        }
      })
      if (mountedRef.current) {
        setForm(null)
        setErrors({})
      }
    } finally {
      if (mountedRef.current) {
        setSaving(false)
      }
    }
  }

  const remove = async (profileId: string): Promise<void> => {
    // Why: a profile is a re-creatable mapping with no data at stake (D12) — single click, no dialog.
    await window.api.sftp.deleteProfile({ workspacePath, profileId })
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-3">
        <div className="space-y-0.5">
          <p className="text-sm font-medium">
            {translate('auto.components.settings.SftpProfilesSection.677014ccb2', 'SFTP Profiles')}
          </p>
          <p className="text-xs text-muted-foreground">
            {translate(
              'auto.components.settings.SftpProfilesSection.27e8c2be56',
              'Upload, download, and compare against a mirrored remote directory — workspace: {{value0}}',
              { value0: workspacePath }
            )}
          </p>
        </div>
        <Button variant="outline" size="xs" onClick={openForm} className="gap-1.5">
          <Plus className="size-3" />
          {translate('auto.components.settings.SftpProfilesSection.b8e7f05b3a', 'Add profile')}
        </Button>
      </div>

      {profiles.length === 0 && form === null ? (
        <div className="flex items-center justify-center rounded-lg border border-dashed border-border/60 bg-card/30 px-4 py-4 text-xs text-muted-foreground">
          {translate(
            'auto.components.settings.SftpProfilesSection.098799b458',
            'No SFTP profiles for this workspace yet.'
          )}
        </div>
      ) : (
        <div className="space-y-1.5">
          {profiles.map((profile) => (
            <div
              key={profile.id}
              className="flex items-center gap-3 rounded-lg border border-border/50 bg-card/40 px-3 py-2"
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline gap-2">
                  <span className="truncate text-sm font-medium">{profile.label}</span>
                  <span className="text-[11px] text-muted-foreground">
                    {targetLabelFor(targets, profile.targetId)}
                  </span>
                </div>
                <p className="truncate text-xs text-muted-foreground">
                  {profile.localRoot} → {profile.defaultRemoteDir}
                </p>
              </div>
              <Button
                variant="ghost"
                size="icon"
                className="size-7 text-muted-foreground"
                aria-label={translate(
                  'auto.components.settings.SftpProfilesSection.15141eab3a',
                  'Edit profile'
                )}
                onClick={() => startEdit(profile)}
              >
                <Pencil className="size-3" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="size-7 text-muted-foreground hover:text-red-400"
                aria-label={translate(
                  'auto.components.settings.SftpProfilesSection.7035d2d95f',
                  'Delete profile'
                )}
                onClick={() => void remove(profile.id)}
              >
                <Trash2 className="size-3" />
              </Button>
            </div>
          ))}
        </div>
      )}

      {form !== null ? (
        <div className="space-y-2 rounded-lg border border-border/50 bg-card/40 p-3">
          <p className="text-[11px] font-medium text-muted-foreground">
            {form.id === ''
              ? translate('auto.components.settings.SftpProfilesSection.b8e7f05b3a', 'Add profile')
              : translate(
                  'auto.components.settings.SftpProfilesSection.15141eab3a',
                  'Edit profile'
                )}
          </p>
          <div className="grid grid-cols-2 gap-2">
            <label className="space-y-1">
              <span className="text-[11px] font-medium text-muted-foreground">
                {translate('auto.components.settings.SftpProfilesSection.74341e3c27', 'Label')}
              </span>
              <Input
                aria-label={translate(
                  'auto.components.settings.SftpProfilesSection.74341e3c27',
                  'Label'
                )}
                className="h-8 text-sm"
                value={form.label}
                onChange={(e) => setForm({ ...form, label: e.target.value })}
              />
            </label>
            <label className="space-y-1">
              <span className="text-[11px] font-medium text-muted-foreground">
                {translate('auto.components.settings.SftpProfilesSection.61ad50a9b9', 'Target')}
              </span>
              <select
                aria-label={translate(
                  'auto.components.settings.SftpProfilesSection.61ad50a9b9',
                  'Target'
                )}
                className="h-8 w-full rounded-md border border-input bg-background px-2 text-sm"
                value={form.targetId}
                onChange={(e) => setForm({ ...form, targetId: e.target.value })}
              >
                <option value="">
                  {translate(
                    'auto.components.settings.SftpProfilesSection.a2c419e375',
                    'Select target…'
                  )}
                </option>
                {targets.map((target) => (
                  <option key={target.id} value={target.id}>
                    {target.label} ({target.username}@{target.host})
                  </option>
                ))}
              </select>
              {errors.target ? (
                <span className="text-[11px] text-red-400">{errors.target}</span>
              ) : null}
            </label>
            <label className="space-y-1">
              <span className="text-[11px] font-medium text-muted-foreground">
                {translate('auto.components.settings.SftpProfilesSection.9f69f4a20d', 'Local root')}
              </span>
              <Input
                aria-label={translate(
                  'auto.components.settings.SftpProfilesSection.9f69f4a20d',
                  'Local root'
                )}
                className="h-8 text-sm"
                value={form.localRoot}
                onChange={(e) => setForm({ ...form, localRoot: e.target.value })}
              />
            </label>
            <label className="space-y-1">
              <span className="text-[11px] font-medium text-muted-foreground">
                {translate('auto.components.settings.SftpProfilesSection.4bc2d9935e', 'Remote dir')}
              </span>
              <Input
                aria-label={translate(
                  'auto.components.settings.SftpProfilesSection.4bc2d9935e',
                  'Remote dir'
                )}
                className="h-8 text-sm"
                value={form.defaultRemoteDir}
                onChange={(e) => setForm({ ...form, defaultRemoteDir: e.target.value })}
              />
              {errors.defaultRemoteDir ? (
                <span className="text-[11px] text-red-400">{errors.defaultRemoteDir}</span>
              ) : null}
            </label>
          </div>
          <div className="flex justify-end gap-1.5">
            <Button variant="outline" size="sm" onClick={() => setForm(null)}>
              {translate('auto.components.settings.SftpProfilesSection.77dfd2135f', 'Cancel')}
            </Button>
            <Button size="sm" disabled={saving} onClick={() => void save()}>
              {translate('auto.components.settings.SftpProfilesSection.efc007a393', 'Save')}
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  )
}
