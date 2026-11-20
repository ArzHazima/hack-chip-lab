import { useRef, type ChangeEvent } from 'react'

interface Props {
  cmpName: string | null
  onUpload: (file: File) => void
  onRun: () => void
}

export default function TopBar({ cmpName, onUpload, onRun }: Props) {
  const fileRef = useRef<HTMLInputElement>(null)

  const onChange = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) onUpload(file)
    e.target.value = '' // allow re-uploading the same file after editing it
  }

  return (
    <header className="topbar">
      <strong className="brand">Hack Chip Lab</strong>
      <input ref={fileRef} type="file" accept=".cmp,text/plain" hidden onChange={onChange} />
      <button onClick={() => fileRef.current?.click()}>Upload .cmp</button>
      <span className="file-name">{cmpName ?? 'no file loaded'}</span>
      <button className="primary" onClick={onRun}>
        ▶ Run
      </button>
    </header>
  )
}
