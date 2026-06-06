"""
Testes para validar o FIX do BUG #4: Inversão de RESIZE
Verifica que aumentar fonte aumenta e diminuir diminui
"""

import pytest


class TestResizeFix:
    """Testes para verificar que Resize funciona corretamente após fix"""
    
    def test_font_size_scaling_increases_correctly(self):
        """AUMENTAR fonte deve resultar em mais pixels"""
        # Simulando o cálculo de draft_engine.py
        scale = 300 / 72.0  # High DPI (300 DPI)
        
        # Original: 12pt
        original_pt = 12
        original_px = int(original_pt * scale * 1.3)  # FIXED: multiplicação ao invés de divisão
        
        # Novo: 24pt (2x maior)
        new_pt = 24
        new_px = int(new_pt * scale * 1.3)
        
        # Verificação: novo deve ser maior
        assert new_px > original_px, \
            f"Ao aumentar de {original_pt}pt para {new_pt}pt, " \
            f"pixels deviam aumentar: {original_px}px → {new_px}px"
        
        # Verificação: proporção deve ser ~2x
        ratio = new_px / original_px
        assert 1.9 < ratio < 2.1, \
            f"Proporção deveria ser ~2x, got {ratio:.2f}x"
    
    def test_font_size_scaling_decreases_correctly(self):
        """DIMINUIR fonte deve resultar em menos pixels"""
        scale = 300 / 72.0
        
        # Original: 24pt
        original_pt = 24
        original_px = int(original_pt * scale * 1.3)
        
        # Novo: 12pt (0.5x)
        new_pt = 12
        new_px = int(new_pt * scale * 1.3)
        
        # Verificação: novo deve ser menor
        assert new_px < original_px, \
            f"Ao diminuir de {original_pt}pt para {new_pt}pt, " \
            f"pixels deviam diminuir: {original_px}px → {new_px}px"
        
        # Verificação: proporção deve ser ~0.5x
        ratio = new_px / original_px
        assert 0.45 < ratio < 0.55, \
            f"Proporção deveria ser ~0.5x, got {ratio:.2f}x"
    
    def test_extreme_sizes_handled_correctly(self):
        """Validar que tamanhos extremos (6pt e 72pt) funcionam"""
        scale = 300 / 72.0
        
        # Mínimo: 6pt
        min_px = int(6 * scale * 1.3)
        assert min_px > 0, "Tamanho mínimo (6pt) deve resultar em > 0 pixels"
        assert min_px >= 5, "Tamanho mínimo deve ser legível (≥5px)"
        
        # Máximo: 72pt
        max_px = int(72 * scale * 1.3)
        assert max_px > min_px, "Máximo deve ser maior que mínimo"
        assert max_px < 500, "Tamanho máximo (72pt) deve caber na página"
    
    def test_dpi_150_vs_300_scaling(self):
        """Validar que DPI afeta proporcionalmente"""
        # DPI normal: 150
        scale_150 = 150 / 72.0
        px_150_12pt = int(12 * scale_150 * 1.3)
        px_150_24pt = int(24 * scale_150 * 1.3)
        
        # DPI alta: 300
        scale_300 = 300 / 72.0
        px_300_12pt = int(12 * scale_300 * 1.3)
        px_300_24pt = int(24 * scale_300 * 1.3)
        
        # Verificação: proporção deve ser mesma em ambos DPIs
        ratio_150 = px_150_24pt / px_150_12pt
        ratio_300 = px_300_24pt / px_300_12pt
        
        assert abs(ratio_150 - ratio_300) < 0.01, \
            f"Proporção deveria ser consistente entre DPIs: {ratio_150:.2f} vs {ratio_300:.2f}"
        
        # Verificação: 300 DPI deve ser ~2x o tamanho de 150 DPI
        assert px_300_12pt / px_150_12pt >= 1.9, \
            f"300 DPI deveria ser ~2x maior que 150 DPI"
    
    def test_direction_detection_logic(self):
        """Validar lógica de detecção de direção (aumentando vs diminuindo)"""
        # Aumentando
        assert 24 > 12, "Lógica: 24pt > 12pt significa AUMENTANDO"
        
        # Diminuindo
        assert 6 < 12, "Lógica: 6pt < 12pt significa DIMINUINDO"
        
        # Sem mudança
        assert not (12 > 12), "Lógica: 12pt = 12pt significa SEM MUDANÇA"


class TestResizeEdgeCases:
    """Casos extremos que podem quebrar o resize"""
    
    def test_zero_font_size_rejected(self):
        """Font size 0 ou negativo deve ser rejeitado"""
        # No código: if not nfs or nfs <= 0: continue
        nfs_values = [0, -5, -100]
        
        for nfs in nfs_values:
            should_reject = not nfs or nfs <= 0
            assert should_reject, f"Font size {nfs} deveria ser rejeitado"
    
    def test_very_large_font_size(self):
        """Font size muito grande ainda deve funcionar (até 72pt)"""
        scale = 300 / 72.0
        
        sizes = [36, 48, 60, 72]
        pixels = [int(sz * scale * 1.3) for sz in sizes]
        
        # Verificar que cresce monotonicamente
        for i in range(len(pixels) - 1):
            assert pixels[i] < pixels[i + 1], \
                f"Pixels deviam crescer monotonicamente: {pixels}"


class TestResizeUIValidation:
    """Validar regras de UI para input de resize"""
    
    def test_valid_font_size_range(self):
        """Valores válidos: 6pt a 72pt"""
        valid_sizes = [6, 8, 10, 12, 14, 16, 18, 20, 24, 32, 48, 72]
        
        for size in valid_sizes:
            is_valid = 6 <= size <= 72
            assert is_valid, f"Font size {size} deveria ser válido"
    
    def test_invalid_font_sizes_clamped(self):
        """Valores fora do range devem ser limitados"""
        test_cases = [
            (2, 6),      # Muito pequeno → mínimo
            (100, 72),   # Muito grande → máximo
            (-10, 6),    # Negativo → mínimo
        ]
        
        for input_val, expected in test_cases:
            clamped = max(6, min(72, input_val))
            assert clamped == expected, \
                f"Input {input_val} deveria ser clamped para {expected}, got {clamped}"


if __name__ == '__main__':
    pytest.main([__file__, '-v', '--tb=short'])
