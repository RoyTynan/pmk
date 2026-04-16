'use client'
import { useAppState } from '@/contexts/AppState'
import styles from './TopBar.module.css'

interface Props {
  wsDot?: React.ReactNode
}

export default function TopBar({ wsDot }: Props) {
  const { kernel } = useAppState()

  return (
    <div className={styles.bar}>
      <h1 className={styles.title}>PMK {wsDot}</h1>
      <div className={styles.sys}>
        <span className={`${styles.kernelStatus} ${kernel.running ? styles.kernelOn : styles.kernelOff}`}>
          {kernel.running ? 'kernel ● running' : 'kernel ○ stopped'}
        </span>
      </div>
    </div>
  )
}
