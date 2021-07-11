import { Select } from "antd"
import { useRouter } from "next/router"
import React, { useEffect, useState } from "react"
import { useDispatch, useSelector, useStore } from "react-redux"
import HelpModal from "../HelpModal"
import useText from "../../lib/useText"
import { co2PageUpdateQuery } from "components/CO2Forecast/calculate"

const DEBUG = false

export default function SourceSelector( { sources, stateKey, placeholder } ) {
	const router = useRouter()
	const { getText } = useText()
	const store = useStore()
	const [ selectedSourceOption, set_selectedSourceOption ] = useState()
	const dispatch = useDispatch()
	const stateValue = useSelector( redux => redux[ stateKey ] )

	if( DEBUG && stateKey === 'productionSourceId' )
		console.log( { stateKey, sources: sources.length, stateValue, selectedSourceOption } )

	useEffect( () => {
		if( router.query[ stateKey ] )
			set_selectedSourceOption( router.query[ stateKey ] )
	}, [ router.query[ stateKey ] ] )

	useEffect( () => { // Make only source selected
		if( !sources?.length === 1 ) return
		const id = sources?.[ 0 ]?.sourceId
		console.log( stateKey, '>>>>>>>>>> Single source:', sources )
		set_selectedSourceOption( id?.toString() )
		co2PageUpdateQuery( store, router, stateKey, id )
		dispatch( { type: stateKey.toUpperCase(), payload: parseInt( id ) } )

	}, [ sources?.length === 1 ] )

	useEffect( () => { // Clear selection if selected value is no longer available.
		if( !stateValue ) return

		console.log( stateKey, { stateValue, selectedSourceOption, sources } )

		if( sources?.length === 0 ) {
			console.log( stateKey, '>>>>>>>>>> Source empty' )
			set_selectedSourceOption( undefined )
			co2PageUpdateQuery( store, router, stateKey, undefined )
			dispatch( { type: stateKey.toUpperCase(), payload: null } )
			return
		}

		if( !sources.find( s => s.sourceId === parseInt( selectedSourceOption ) ) ) {
			console.log( stateKey, '>>>>>>>>>> Reset' )
			set_selectedSourceOption( undefined )
			_updateQuery( store, router, stateKey, undefined )
			console.log( stateKey, '>>>>>>>>>> Reset' )
			set_selectedSourceOption( undefined )
			_updateQuery( store, router, stateKey, undefined )
		}
	}, [ sources, stateValue, selectedSourceOption ] )

	return (
		<div style={ { marginTop: 12 } }>
			<Select
				showSearch
				style={ { minWidth: 120, width: '100%' } }
				value={ selectedSourceOption }
				allowClear={ true }
				placeholder={ placeholder }
				defaultActiveFirstOption={ true }
				onChange={ async value => {
					set_selectedSourceOption( value )
					dispatch( { type: stateKey.toUpperCase(), payload: parseInt( value ) } )
					await co2PageUpdateQuery( store, router, stateKey, value )
				} }
			>
				{ sources.map( s => {
					let name = s.name + ' (' + s.namePretty + ')'
					if( s.name?.startsWith( 'name_' ) ) name = getText( s.name ) + ' (' + getText( s.namePretty ) + ')'

					return (
						<Select.Option key={ s.sourceId }>
							{ name }
							{ s.description?.startsWith( 'explanation_' ) &&
							<HelpModal
								title={ placeholder }
								content={ s.description }
							/>
							}
						</Select.Option> )
				} ) }
			</Select>
		</div>
	)
}
