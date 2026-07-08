import React, { useState } from 'react';
import { supabase } from '../supabaseClient';
import { ShoppingCart, Plus, Check, Square, Trash2, CheckCircle } from 'lucide-react';
import { useMutation, useQueryClient } from '@tanstack/react-query';

export default function Shopping({ profile, houseId, houseMembers, shoppingItems }) {
    const queryClient = useQueryClient();
    const [name, setName] = useState('');
    const [quantity, setQuantity] = useState('1');
    const [submitError, setSubmitError] = useState('');
    const [loading, setLoading] = useState(false);

    // 1. Mutation: Add shopping item
    const appendItemMutation = useMutation({
        mutationFn: async (newItem) => {
            const { data, error } = await supabase
                .from('shopping_items')
                .insert([newItem])
                .select();
            if (error) throw error;
            return data;
        },
        onSuccess: () => {
            queryClient.invalidateQueries(['shopping_items']);
            setName('');
            setQuantity('1');
        }
    });

    // 2. Mutation: Check off item as purchased
    const checkItemMutation = useMutation({
        mutationFn: async ({ itemId, isChecked }) => {
            const { data, error } = await supabase
                .from('shopping_items')
                .update({
                    is_purchased: isChecked,
                    purchased_at: isChecked ? new Date().toISOString() : null,
                    purchased_by: isChecked ? profile.id : null
                })
                .eq('id', itemId)
                .select();
            if (error) throw error;
            return data;
        },
        onSuccess: () => {
            queryClient.invalidateQueries(['shopping_items']);
        }
    });

    // 3. Mutation: Delete/Clear settled item
    const deleteItemMutation = useMutation({
        mutationFn: async (itemId) => {
            const { error } = await supabase
                .from('shopping_items')
                .delete()
                .eq('id', itemId);
            if (error) throw error;
        },
        onSuccess: () => {
            queryClient.invalidateQueries(['shopping_items']);
        }
    });

    const handleAddSubmit = async (e) => {
        e.preventDefault();
        setSubmitError('');

        if (!name.trim()) {
            setSubmitError('Please enter an item name.');
            return;
        }

        setLoading(true);

        try {
            await appendItemMutation.mutateAsync({
                house_id: houseId,
                name: name.trim(),
                quantity: quantity.trim() || '1',
                added_by: profile.id,
                is_purchased: false
            });
        } catch (err) {
            setSubmitError(err.message || 'Error occurred while saving item.');
        } finally {
            setLoading(false);
        }
    };

    const handleTogglePurchase = async (itemId, isCurrentlyPurchased) => {
        try {
            await checkItemMutation.mutateAsync({
                itemId,
                isChecked: !isCurrentlyPurchased
            });
        } catch (err) {
            alert('Error updating purchase status: ' + err.message);
        }
    };

    const handleDeleteItem = async (itemId) => {
        if (window.confirm('Delete this item from list?')) {
            try {
                await deleteItemMutation.mutateAsync(itemId);
            } catch (err) {
                alert('Error deleting item: ' + err.message);
            }
        }
    };

    // Divide active and purchased
    const activeItems = shoppingItems.filter(i => !i.is_purchased);
    const purchasedItems = shoppingItems.filter(i => i.is_purchased);

    return (
        <div>
            <div className="section-header">
                <div>
                    <h2>Shopping List</h2>
                    <p className="text-secondary">Keep track of groceries, household essentials, and cleaning supplies.</p>
                </div>
            </div>

            <div className="grid-3" style={{ alignItems: 'flex-start' }}>
                {/* Left Column: Form to Add Item */}
                <div className="glass-card" style={{ gridColumn: 'span 1' }}>
                    <h3 style={{ marginBottom: '16px' }}>Request Supplies</h3>

                    <form onSubmit={handleAddSubmit} className="spaced-y-4">
                        {submitError && <div className="feedback-alert error-alert">{submitError}</div>}

                        <div className="form-group">
                            <label className="form-label" htmlFor="shop-item">Item Name</label>
                            <input
                                id="shop-item"
                                type="text"
                                className="input-field"
                                placeholder="e.g. Milk, Toilet Paper, Dish Soap"
                                value={name}
                                onChange={(e) => setName(e.target.value)}
                                disabled={loading}
                                required
                            />
                        </div>

                        <div className="form-group">
                            <label className="form-label" htmlFor="shop-qty">Quantity / Unit</label>
                            <input
                                id="shop-qty"
                                type="text"
                                className="input-field"
                                placeholder="e.g. 2 packs, 1 gallon"
                                value={quantity}
                                onChange={(e) => setQuantity(e.target.value)}
                                disabled={loading}
                            />
                        </div>

                        <button type="submit" className="btn btn-primary w-full" disabled={loading}>
                            <Plus size={18} /> Add to List
                        </button>
                    </form>
                </div>

                {/* Right Column: Interactive Boards */}
                <div style={{ gridColumn: 'span 2', display: 'flex', flexDirection: 'column', gap: '24px' }}>
                    {/* Active section */}
                    <div className="glass-card">
                        <h3 style={{ marginBottom: '16px' }}>Needs Purchase ({activeItems.length})</h3>

                        {activeItems.length === 0 ? (
                            <p className="helper-text font-italic">Everything looks stocked! Add items when supplies run low.</p>
                        ) : (
                            <div className="list-container">
                                {activeItems.map(item => {
                                    const requester = houseMembers.find(m => m.id === item.added_by);

                                    return (
                                        <div key={item.id} className="list-item">
                                            <div className="list-item-content">
                                                <button
                                                    onClick={() => handleTogglePurchase(item.id, item.is_purchased)}
                                                    className="list-item-checkbox"
                                                >
                                                    {item.is_purchased && <Check size={14} />}
                                                </button>
                                                <div>
                                                    <p className="list-item-title">{item.name}</p>
                                                    <small className="text-muted">
                                                        Quantity: <strong>{item.quantity}</strong> • Requested by: {requester?.name || 'Unknown'}
                                                    </small>
                                                </div>
                                            </div>

                                            <button onClick={() => handleDeleteItem(item.id)} className="share-btn">
                                                <Trash2 size={16} />
                                            </button>
                                        </div>
                                    );
                                })}
                            </div>
                        )}
                    </div>

                    {/* Purchased details */}
                    <div className="glass-card" style={{ opacity: 0.8 }}>
                        <h3 style={{ marginBottom: '16px' }}>Purchased Recently ({purchasedItems.length})</h3>

                        {purchasedItems.length === 0 ? (
                            <p className="helper-text font-italic">No checkout records in this session.</p>
                        ) : (
                            <div className="list-container">
                                {purchasedItems.map(item => {
                                    const buyer = houseMembers.find(m => m.id === item.purchased_by);

                                    return (
                                        <div key={item.id} className="list-item">
                                            <div className="list-item-content">
                                                <button
                                                    onClick={() => handleTogglePurchase(item.id, item.is_purchased)}
                                                    className="list-item-checkbox checked"
                                                >
                                                    <Check size={14} />
                                                </button>
                                                <div>
                                                    <p className="list-item-title completed">{item.name}</p>
                                                    <small className="text-muted">
                                                        Bought by {buyer?.name || 'Someone'} on {new Date(item.purchased_at).toLocaleDateString()}
                                                    </small>
                                                </div>
                                            </div>

                                            <button onClick={() => handleDeleteItem(item.id)} className="share-btn">
                                                <Trash2 size={16} />
                                            </button>
                                        </div>
                                    );
                                })}
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}
