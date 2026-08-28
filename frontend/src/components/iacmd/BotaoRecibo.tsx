import { useState, type CSSProperties } from 'react';
import { Receipt, Loader2 } from 'lucide-react';
import { apiDownload } from '../../lib/api';

/**
 * Botão "Recibo" — baixa o PDF de uma fatura JÁ PAGA.
 *
 * Mesmo componente no painel do assinante e no super admin; só muda a rota
 * (`/minhas-faturas/:id/recibo` x `/admin/faturas/:id/recibo`). Assim o
 * comportamento (estado de carregando, erro, nome do arquivo) é idêntico nos
 * dois lugares e não sai de sincronia.
 */
export default function BotaoRecibo({
  path,
  arquivo,
  onErro,
  className,
  style,
  rotulo = 'Recibo',
}: {
  path: string;
  arquivo: string;
  onErro?: (msg: string) => void;
  className?: string;
  style?: CSSProperties;
  rotulo?: string;
}) {
  const [baixando, setBaixando] = useState(false);

  const baixar = async () => {
    setBaixando(true);
    try {
      await apiDownload(path, arquivo);
    } catch (e) {
      // 412 = emitente não preenchido; a mensagem do backend já explica o que
      // fazer, então repassa como está em vez de inventar texto genérico.
      onErro?.(e instanceof Error ? e.message : 'Não foi possível gerar o recibo.');
    } finally {
      setBaixando(false);
    }
  };

  const padrao: CSSProperties = {
    display: 'inline-flex', alignItems: 'center', gap: 6,
    padding: '7px 12px', borderRadius: 8,
    border: '1px solid var(--c-border)', background: 'var(--c-surface)',
    color: 'var(--c-ink2)', fontSize: 12.5, fontWeight: 700,
    cursor: baixando ? 'default' : 'pointer', fontFamily: 'inherit',
    opacity: baixando ? 0.6 : 1,
  };

  return (
    <button
      type="button"
      onClick={() => void baixar()}
      disabled={baixando}
      title="Baixar o recibo desta fatura em PDF"
      className={className}
      style={className ? style : { ...padrao, ...style }}
    >
      {baixando
        ? <Loader2 size={14} style={{ animation: 'ia-spin .8s linear infinite' }} />
        : <Receipt size={14} />}
      {baixando ? 'Gerando…' : rotulo}
    </button>
  );
}
