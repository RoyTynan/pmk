'use client'
import { useAppState } from '@/contexts/AppState'
import styles from './TopBar.module.css'

interface Props {
  wsDot?: React.ReactNode
}

export default function TopBar({ wsDot }: Props) {
  const { host } = useAppState()

  return (
    <div className={styles.bar}>
      <h1 className={styles.title}>HostScheduler {wsDot}</h1>
      <div className={styles.sys}>
        <span className={`${styles.hostStatus} ${host.running ? styles.hostOn : styles.hostOff}`}>
          {host.running ? 'host ● running' : 'host ○ stopped'}
        </span>
      </div>
    </div>
  )
}
