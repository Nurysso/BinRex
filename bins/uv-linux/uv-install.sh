#!/bin/bash

# check if uv is already installed
if command -v uv &> /dev/null; then
    echo "uv already installed"
else
    curl -LsSf https://astral.sh/uv/install.sh | sh

    # test if uv actually works
    if command -v uv &> /dev/null; then
        echo "uv installed successfully"
        uv self version
    else
        echo "uv installation failed"
        exit 1
    fi
fi

# setup shell completions based on user's shell
user_shell=$(basename "$SHELL")

case "$user_shell" in
    bash)
        echo "setting up bash completions..."
        echo 'eval "$(uv generate-shell-completion bash)"' >> ~/.bashrc
        echo 'eval "$(uvx --generate-shell-completion bash)"' >> ~/.bashrc
        echo "completions added to ~/.bashrc"
        ;;
    zsh)
        echo "setting up zsh completions..."
        echo 'eval "$(uv generate-shell-completion zsh)"' >> ~/.zshrc
        echo 'eval "$(uvx --generate-shell-completion zsh)"' >> ~/.zshrc
        echo "completions added to ~/.zshrc"
        ;;
    fish)
        echo "setting up fish completions..."
        mkdir -p ~/.config/fish/completions
        echo 'uv generate-shell-completion fish | source' > ~/.config/fish/completions/uv.fish
        echo 'uvx --generate-shell-completion fish | source' > ~/.config/fish/completions/uvx.fish
        echo "completions added to ~/.config/fish/completions/"
        ;;
    *)
        echo "shell '$user_shell' not supported for auto-completions, skipping..."
        ;;
esac

echo "done! restart your shell or source your config file to enable completions"
