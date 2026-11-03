import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { EmptyState, ErrorState, LoadingState } from '@/components/shared/states'

describe('estados compartidos', () => {
  it('LoadingState anuncia la carga', () => {
    render(<LoadingState label="Cargando productos" />)
    expect(screen.getByRole('status')).toHaveTextContent('Cargando productos')
  })
  it('ErrorState permite reintentar', async () => {
    const onRetry = vi.fn()
    render(<ErrorState message="Fallo" onRetry={onRetry} />)
    expect(screen.getByRole('alert')).toHaveTextContent('Fallo')
    await userEvent.click(screen.getByRole('button', { name: 'Reintentar' }))
    expect(onRetry).toHaveBeenCalledOnce()
  })
  it('EmptyState muestra título y descripción', () => {
    render(<EmptyState title="Sin datos" description="Nada aún" />)
    expect(screen.getByText('Sin datos')).toBeInTheDocument()
    expect(screen.getByText('Nada aún')).toBeInTheDocument()
  })
})
